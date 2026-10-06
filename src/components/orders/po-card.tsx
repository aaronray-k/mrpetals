import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Boxes, CheckCircle2, Send, XCircle } from 'lucide-react'
import { assignBoxes, productLabel, respondPo, sendPo, type Order, type PoLine, type PurchaseOrder, type Shipment } from '~/lib/orders/api'
import { Button } from '~/components/ui/button'
import { useToast } from '~/components/ui/toaster'
import { formatDate } from './shipment-status'
import { boxesFor, type OrderRefs } from './order-lines'
import { ReasonDialog } from './reason-dialog'
import { PoStatus } from './status'

/** A farm's PO for this order, with the next step it is waiting for. */
export function PoCard({
  order,
  po,
  lines,
  activeBoxes,
  shipment,
  refs,
  canEdit,
  onChanged,
}: {
  order: Order
  po: PurchaseOrder
  lines: PoLine[]
  activeBoxes: number
  shipment: Shipment | null
  refs: OrderRefs
  canEdit: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [declining, setDeclining] = React.useState(false)
  const farm = refs.farms.find((f) => f.id === po.farm_id)
  const stems = lines.reduce((s, l) => s + l.stems, 0)
  const expected = lines.reduce((s, l) => s + boxesFor(l.stems, l.stems_per_box), 0)
  const product = (id: string) => refs.products.find((p) => p.id === id)
  const headingId = `po-${po.id}`

  async function run(title: string, fn: () => Promise<string | void>) {
    setBusy(true)
    try {
      const detail = await fn()
      toast({ kind: 'success', title, description: detail || undefined })
      onChanged()
    } catch (e) {
      toast({ kind: 'error', title: `${po.po_number}: not done`, description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={headingId} className="font-bold">
            {farm?.farm_name ?? 'Farm'} <span className="font-mono text-sm font-normal text-muted-foreground">{po.po_number}</span>
          </h3>
          <p className="text-sm text-muted-foreground">
            {stems.toLocaleString('en-GB')} stems · {expected} {expected === 1 ? 'box' : 'boxes'} · deliver {formatDate(po.delivery_date)}
          </p>
        </div>
        <PoStatus status={po.status} />
      </div>

      <ul className="grid gap-1 text-sm">
        {lines.map((l) => {
          const p = product(l.product_id)
          return (
            <li key={l.id}>
              {p ? productLabel(p) : 'Product'}: {l.stems.toLocaleString('en-GB')} stems, {l.stems_per_box} per box
            </li>
          )
        })}
      </ul>

      {po.status === 'declined' && po.decline_reason && (
        <p className="flex items-start gap-1.5 text-sm">
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            <strong>Farm declined:</strong> {po.decline_reason}. Change or remove its lines above; the PO goes back to draft so you can send it
            again.
          </span>
        </p>
      )}

      {po.answer_log
        ?.flatMap((a) => a.short)
        .map((x, i) => (
          <p key={i} className="flex items-start gap-1.5 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              <strong>Farm confirmed part:</strong> {x.product}: {x.confirmed.toLocaleString('en-GB')} of {x.asked.toLocaleString('en-GB')} stems.
              The rest shows as still to place on the line.
            </span>
          </p>
        ))}
      {po.status === 'cancelled' && (
        <p className="flex items-start gap-1.5 text-sm">
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {po.cancel_reason ?? 'Cancelled.'}
        </p>
      )}

      {po.boxes_assigned_at && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <Boxes className="size-4 text-success" aria-hidden="true" />
          {activeBoxes} {activeBoxes === 1 ? 'box' : 'boxes'} on{' '}
          {shipment ? (
            <Link to="/shipments/$shipmentId" params={{ shipmentId: shipment.id }} className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
              shipment {shipment.shipment_ref}
            </Link>
          ) : (
            'the shipment'
          )}
        </p>
      )}

      {canEdit && order.status === 'open' && (
        <div className="flex flex-wrap gap-2">
          {po.status === 'draft' && (
            <Button size="sm" disabled={busy} onClick={() => run(`${po.po_number} sent to ${farm?.farm_name ?? 'the farm'}`, () => sendPo(po.id))}>
              <Send aria-hidden="true" /> Send to farm
            </Button>
          )}
          {po.status === 'sent' && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`${po.po_number} confirmed`, () => respondPo(po.id, true))}>
                <CheckCircle2 aria-hidden="true" /> Farm confirmed
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
                <XCircle aria-hidden="true" /> Farm declined…
              </Button>
            </>
          )}
          {po.status === 'confirmed' && !po.boxes_assigned_at && (
            <>
              <Button
                size="sm"
                disabled={busy || !shipment || shipment.status === 'closed'}
                onClick={() =>
                  run('Boxes assigned', async () => {
                    const n = await assignBoxes(po.id)
                    return `${n} ${n === 1 ? 'box' : 'boxes'} added to ${shipment?.shipment_ref}.`
                  })
                }
              >
                <Boxes aria-hidden="true" /> Assign boxes ({expected})
              </Button>
              {!shipment && <span className="self-center text-sm text-muted-foreground">Choose the order's shipment first.</span>}
              {shipment?.status === 'closed' && <span className="self-center text-sm text-muted-foreground">The order's shipment is closed.</span>}
            </>
          )}
        </div>
      )}
      {po.status === 'sent' && canEdit && (
        <p className="text-sm text-muted-foreground">The farm can answer on its own page, or record its answer here.</p>
      )}

      <ReasonDialog
        open={declining}
        onClose={() => setDeclining(false)}
        title={`${farm?.farm_name ?? 'Farm'} declined ${po.po_number}`}
        label="What did the farm say?"
        confirmLabel="Record decline"
        destructive
        onConfirm={async (reason) => {
          await respondPo(po.id, false, reason)
          toast({ kind: 'success', title: `${po.po_number} marked declined` })
          onChanged()
        }}
      />
    </section>
  )
}
