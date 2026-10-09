import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Undo2, XCircle } from 'lucide-react'
import { productLabel, respondPo, useFarmPurchaseOrders, type PurchaseOrder } from '~/lib/orders/api'
import { answerPo } from '~/lib/ordering/api'
import { Input } from '~/components/ui/input'
import { formatDateTime } from '~/lib/utils'
import { useQcReasons, useReturnedBoxes } from '~/lib/qc/api'
import { BoxPhotosButton } from '~/components/qc/box-photos'
import { reasonLabels } from '~/components/qc/qc-badge'
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
  { status: 'cancelled', title: 'Cancelled by ConsolFlora', empty: 'No cancelled purchase orders.' },
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
        <ReturnedBoxes />
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

      {po.status === 'sent' && <AnswerForm po={po} busy={busy} setBusy={setBusy} onDecline={() => setDeclining(true)} onChanged={onChanged} />}
      {po.status === 'cancelled' && <p className="text-sm">{po.cancel_reason ?? 'ConsolFlora cancelled this PO.'} Don't send these flowers.</p>}

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

/** Boxes ConsolFlora's QC sent back, with the reasons from the claim policy and the photos. */
function ReturnedBoxes() {
  const q = useReturnedBoxes()
  const reasons = useQcReasons()
  if (!q.data?.length) return null
  return (
    <section aria-labelledby="returned-title" className="grid gap-3">
      <h2 id="returned-title" className="flex items-center gap-2 text-xl font-bold">
        <Undo2 className="size-5 text-destructive" aria-hidden="true" /> Sent back to you <span className="text-muted-foreground">({q.data.length})</span>
      </h2>
      <p className="text-sm text-muted-foreground">These boxes failed ConsolFlora's QC and come back with a BACK TO FARM sticker. See the claim policy.</p>
      <ul className="grid gap-2">
        {q.data.map((b) => (
          <li key={b.id} className="grid gap-1 rounded-lg border border-destructive/40 bg-card p-3">
            <p className="font-semibold">
              {b.products ? `${b.products.variety} · ${b.products.stem_length_cm} cm · ${b.products.grade}` : 'Box'} · {b.stems} stems
            </p>
            <p className="text-sm">
              Box ID <span className="font-mono">{b.id}</span>
              {b.purchase_order_lines?.purchase_orders && <> · {b.purchase_order_lines.purchase_orders.po_number}</>}
              {b.qc_at && <> · {formatDateTime(b.qc_at)}</>}
            </p>
            <p>
              <strong>Reason:</strong> {reasonLabels(b.qc_reasons, reasons.data).join(', ')}
            </p>
            {b.qc_note && <p className="text-sm">QC note: {b.qc_note}</p>}
            <BoxPhotosButton boxId={b.id} count={b.photo_count} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The farm answers line by line: all the stems (the default) or how many it can supply, and the
 * day it delivers (by default the date on the PO, 48 hours before the flight).
 */
function AnswerForm({ po, busy, setBusy, onDecline, onChanged }: { po: FarmPo; busy: boolean; setBusy: (b: boolean) => void; onDecline: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [stems, setStems] = React.useState<Record<string, string>>(() => Object.fromEntries(po.lines.map((l) => [l.id, String(l.stems)])))
  const [date, setDate] = React.useState(po.delivery_date ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const short = po.lines.reduce((s, l) => s + Math.max(0, l.stems - (Number(stems[l.id]) || 0)), 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const bad = po.lines.find((l) => !/^\d+$/.test((stems[l.id] ?? '').trim()) || Number(stems[l.id]) > l.stems)
    if (bad) return setError(`${bad.products?.variety ?? 'A line'}: enter between 0 and ${bad.stems} stems.`)
    if (po.lines.every((l) => Number(stems[l.id]) === 0)) return setError('If you can supply nothing, choose "Can\'t supply any".')
    if (!date) return setError('Choose the day you deliver.')
    setBusy(true)
    setError(null)
    try {
      const r = await answerPo(
        po.id,
        po.lines.map((l) => ({ po_line_id: l.id, stems: Number(stems[l.id]) })),
        date,
        null,
      )
      toast({
        kind: 'success',
        title: r.short_stems ? `${po.po_number} confirmed in part` : `${po.po_number} confirmed`,
        description: r.short_stems ? `ConsolFlora will find the other ${r.short_stems.toLocaleString('en-GB')} stems.` : 'Thank you. ConsolFlora has your answer.',
      })
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 rounded-md bg-muted/60 p-3">
      <p className="font-semibold">How many stems can you supply?</p>
      {po.lines.map((l) => (
        <div key={l.id} className="grid gap-1">
          <label htmlFor={`can-${l.id}`} className="text-sm font-semibold">
            {l.products ? productLabel(l.products) : 'Product'} (asked: {l.stems.toLocaleString('en-GB')})
          </label>
          <Input id={`can-${l.id}`} inputMode="numeric" value={stems[l.id] ?? ''} onChange={(e) => setStems((s) => ({ ...s, [l.id]: e.target.value }))} className="sm:max-w-40" />
        </div>
      ))}
      <div className="grid gap-1">
        <label htmlFor={`date-${po.id}`} className="text-sm font-semibold">
          Delivery to ConsolFlora
        </label>
        <Input id={`date-${po.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="sm:max-w-56" />
      </div>
      {short > 0 && <p className="text-sm font-semibold">You are short by {short.toLocaleString('en-GB')} stems. ConsolFlora will source them elsewhere.</p>}
      {error && (
        <p className="text-sm font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="grid gap-2 sm:flex">
        <Button type="submit" size="lg" disabled={busy}>
          <CheckCircle2 aria-hidden="true" /> {short > 0 ? 'Confirm what I can supply' : 'Confirm all'}
        </Button>
        <Button size="lg" variant="outline" disabled={busy} onClick={onDecline}>
          <XCircle aria-hidden="true" /> Can't supply any…
        </Button>
      </div>
    </form>
  )
}
