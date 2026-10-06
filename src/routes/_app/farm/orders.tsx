import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { productLabel, respondPo, useFarmPurchaseOrders, type PurchaseOrder } from '~/lib/orders/api'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { ReasonDialog } from '~/components/orders/reason-dialog'
import { formatDate } from '~/components/orders/shipment-status'
import { PoStatus } from '~/components/orders/status'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/farm/orders')({
  head: () => ({ meta: [{ title: 'My purchase orders · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/farm/orders')}>
      <FarmOrdersPage />
    </RequireRole>
  ),
})

type FarmPo = NonNullable<ReturnType<typeof useFarmPurchaseOrders>['data']>[number]

const GROUPS: { status: PurchaseOrder['status']; title: string; empty: string }[] = [
  { status: 'sent', title: 'Waiting for your answer', empty: 'Nothing waiting. New purchase orders from ConsolFlora appear here.' },
  { status: 'confirmed', title: 'Confirmed', empty: 'No confirmed purchase orders.' },
  { status: 'declined', title: 'Declined', empty: 'No declined purchase orders.' },
]

function FarmOrdersPage() {
  const q = useFarmPurchaseOrders()
  const queryClient = useQueryClient()
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['farm-pos'] })

  return (
    <>
      <PageHeader title="My purchase orders" description="What ConsolFlora has ordered from your farm. Quantities are in stems." />
      <div className="grid grid-cols-1 gap-6">
        <Tip id="farm.orders" title="Answer each purchase order">
          Tap <strong>Confirm</strong> when you can supply everything on the PO, or <strong>Can't supply</strong> and tell us why. ConsolFlora
          staff see your answer straight away.
        </Tip>
        {q.isLoading && <Spinner />}
        {q.error && (
          <Alert variant="destructive" title="Couldn't load your purchase orders" role="alert">
            {(q.error as Error).message}
          </Alert>
        )}
        {q.data &&
          GROUPS.map((g) => {
            const list = q.data.filter((po) => po.status === g.status)
            return (
              <section key={g.status} aria-labelledby={`group-${g.status}`} className="grid gap-3">
                <h2 id={`group-${g.status}`} className="text-xl font-bold">
                  {g.title} <span className="text-muted-foreground">({list.length})</span>
                </h2>
                {list.length === 0 ? <p className="text-muted-foreground">{g.empty}</p> : list.map((po) => <FarmPoCard key={po.id} po={po} onChanged={refresh} />)}
              </section>
            )
          })}
      </div>
    </>
  )
}

function FarmPoCard({ po, onChanged }: { po: FarmPo; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [declining, setDeclining] = React.useState(false)
  const stems = po.lines.reduce((s, l) => s + l.stems, 0)
  const boxes = po.lines.reduce((s, l) => s + Math.ceil(l.stems / l.stems_per_box), 0)
  const headingId = `po-${po.id}`

  return (
    <Card className="grid gap-3 p-4" role="article" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={headingId} className="font-mono text-lg font-bold">
            {po.po_number}
          </h3>
          <p className="font-semibold">Deliver by {formatDate(po.delivery_date)}</p>
          <p className="text-sm text-muted-foreground">
            {stems.toLocaleString('en-GB')} stems · {boxes} {boxes === 1 ? 'box' : 'boxes'}
            {po.sent_at && <> · sent {formatDateTime(po.sent_at)}</>}
          </p>
        </div>
        <PoStatus status={po.status} />
      </div>

      <ul className="grid gap-2">
        {po.lines.map((l) => (
          <li key={l.id} className="rounded-md border p-3">
            <p className="font-semibold">{l.products ? productLabel(l.products) : 'Product'}</p>
            <p className="text-sm tabular-nums">
              {l.stems.toLocaleString('en-GB')} stems · {l.stems_per_box} per box · {l.box_types?.box_code ?? 'box'} ·{' '}
              {Math.ceil(l.stems / l.stems_per_box)} {Math.ceil(l.stems / l.stems_per_box) === 1 ? 'box' : 'boxes'}
            </p>
            {l.grower_price_per_stem != null && <p className="text-sm text-muted-foreground">Price per stem: {Number(l.grower_price_per_stem).toFixed(3)}</p>}
          </li>
        ))}
      </ul>

      {po.status === 'declined' && po.decline_reason && (
        <p className="flex items-start gap-1.5 text-sm">
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" /> You said: {po.decline_reason}
        </p>
      )}

      {po.status === 'sent' && (
        <div className="grid gap-2 sm:flex">
          <Button
            size="lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await respondPo(po.id, true)
                toast({ kind: 'success', title: `${po.po_number} confirmed`, description: 'Thank you. ConsolFlora has your answer.' })
                onChanged()
              } catch (e) {
                toast({ kind: 'error', title: 'Not confirmed', description: (e as Error).message })
              } finally {
                setBusy(false)
              }
            }}
          >
            <CheckCircle2 aria-hidden="true" /> Confirm
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
            <XCircle aria-hidden="true" /> Can't supply…
          </Button>
        </div>
      )}

      <ReasonDialog
        open={declining}
        onClose={() => setDeclining(false)}
        title={`Can't supply ${po.po_number}`}
        description="ConsolFlora will find another farm or change the order."
        label="Why not? For example: not enough Ever Red this week"
        confirmLabel="Send answer"
        destructive
        onConfirm={async (reason) => {
          await respondPo(po.id, false, reason)
          toast({ kind: 'success', title: `${po.po_number} declined`, description: 'ConsolFlora has your answer.' })
          onChanged()
        }}
      />
    </Card>
  )
}
