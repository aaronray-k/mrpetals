import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet } from 'lucide-react'
import {
  orderKeys,
  shipmentKeys,
  updateOrder,
  useIncoterms,
  useOrder,
  useReferenceData,
  useShipments,
  type Order,
  type Shipment,
} from '~/lib/orders/api'
import { downloadOrderSheet } from '~/lib/orders/download-sheet'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { OrderCharges } from '~/components/orders/order-charges'
import { OrderActions, OrderStatusBadge } from '~/components/orders/order-actions'
import { OrderLineCard } from '~/components/orders/order-lines'
import { PoCard } from '~/components/orders/po-card'
import { formatDate } from '~/components/orders/shipment-status'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/orders/$orderId')({
  head: () => ({ meta: [{ title: 'Order · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/orders')}>
      <OrderPage />
    </RequireRole>
  ),
})

function OrderPage() {
  const { orderId } = Route.useParams()
  const { roles } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const q = useOrder(orderId)
  const ref = useReferenceData()
  const shipments = useShipments()
  const canEdit = hasAnyRole(roles, STAFF_ROLES)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.one(orderId) })
    void queryClient.invalidateQueries({ queryKey: orderKeys.all })
    void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['farm-options'] })
    void queryClient.invalidateQueries({ queryKey: ['buyer-credit'] })
  }

  if (q.isLoading || ref.isLoading) return <Spinner />
  if (q.error) return <Alert variant="destructive" title="Couldn't load this order" role="alert">{(q.error as Error).message}</Alert>
  if (!q.data?.order) return <Alert variant="warning" title="This order doesn't exist" role="alert" />
  const { order, lines, pos, poLines, charges, boxes, coverage } = q.data
  const refs = { farms: ref.data?.farms ?? [], products: ref.data?.products ?? [], packRates: ref.data?.packRates ?? [] }
  const buyer = ref.data?.buyers.find((b) => b.id === order.customer_id)
  const shipment = shipments.data?.find((s) => s.id === order.shipment_id) ?? null

  const totalStems = lines.reduce((s, l) => s + l.stems, 0)
  const placed = poLines.reduce((s, l) => s + l.stems, 0)
  const confirmed = pos.filter((p) => p.status === 'confirmed').length
  const activeBoxes = (poId: string) => {
    const ids = new Set(poLines.filter((l) => l.po_id === poId).map((l) => l.id))
    return boxes.filter((b) => ids.has(b.po_line_id) && b.status === 'active').length
  }

  async function download(withPrices: boolean) {
    if (!buyer) return toast({ kind: 'error', title: 'Buyer details are not available to you' })
    try {
      await downloadOrderSheet(order, buyer, shipment, withPrices)
      toast({ kind: 'success', title: withPrices ? 'Proforma downloaded' : 'Packing list downloaded' })
    } catch (e) {
      toast({ kind: 'error', title: 'Download failed', description: (e as Error).message })
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <Link to="/orders" className="inline-flex min-h-6 items-center justify-self-start text-sm font-semibold text-muted-foreground hover:text-foreground">
            ← All orders
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-3xl font-bold tracking-tight text-primary dark:text-foreground">
            {order.order_number}
            <OrderStatusBadge order={order} />
            {order.standing_order_id && <Badge>Standing order</Badge>}
          </h1>
          <p className="text-muted-foreground">
            {buyer ? `${buyer.company_name} (${buyer.customer_code})` : 'Buyer'} · {order.incoterm} · {order.currency} ·{' '}
            {totalStems.toLocaleString('en-GB')} stems · {placed.toLocaleString('en-GB')} placed · {confirmed} of {pos.length} farm POs confirmed
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => download(true)}>
            <FileSpreadsheet aria-hidden="true" /> Proforma
          </Button>
          <Button variant="outline" onClick={() => download(false)}>
            <FileSpreadsheet aria-hidden="true" /> Packing list
          </Button>
        </div>
      </div>

      {canEdit && (
        <Tip id="orders.detail" title="Split, send, confirm, box">
          Approve the order, then add farms to each line: the calculator recommends the cheapest. <strong>Send to farm</strong>; farms
          confirm in full or in part, and any shortfall shows on the line for you to place with another farm. When every stem is confirmed,{' '}
          <strong>Create packing list</strong> makes the boxes.
        </Tip>
      )}

      <OrderActions order={order} coverage={coverage} hasBoxes={boxes.some((b) => b.status === 'active')} onChanged={refresh} />

      <OrderDetailsCard key={`${order.shipment_id}-${order.ship_date}-${order.farm_delivery_date}-${order.incoterm}-${order.notes}`} order={order} shipments={shipments.data ?? []} canEdit={canEdit} onSaved={refresh} />

      <Card>
        <CardHeader>
          <CardTitle>Lines and farms</CardTitle>
          <CardDescription>Quantities are in stems. Farms see their PO, never the buyer or the margin.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          {lines.map((l) => (
            <OrderLineCard key={l.id} order={order} line={l} pos={pos} poLines={poLines} refs={refs} canEdit={canEdit} canSeeMoney onChanged={refresh} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Farm purchase orders</CardTitle>
          <CardDescription>One PO per farm. A PO can't change once it is sent; if the farm declines, it goes back to draft when you edit it.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          {pos.length === 0 ? (
            <p className="text-muted-foreground">No farms yet. Add a farm to a line above.</p>
          ) : (
            pos.map((po) => (
              <PoCard
                key={po.id}
                order={order}
                po={po}
                lines={poLines.filter((l) => l.po_id === po.id)}
                activeBoxes={activeBoxes(po.id)}
                shipment={shipment}
                refs={refs}
                canEdit={canEdit}
                onChanged={refresh}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Other costs</CardTitle>
          <CardDescription>Added below the lines on the proforma.</CardDescription>
        </CardHeader>
        <CardContent>
          <OrderCharges orderId={order.id} currency={order.currency} charges={charges} canEdit={canEdit} onChanged={refresh} />
        </CardContent>
      </Card>
    </div>
  )
}

function OrderDetailsCard({ order, shipments, canEdit, onSaved }: { order: Order; shipments: Shipment[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast()
  const incoterms = useIncoterms()
  const [shipmentId, setShipmentId] = React.useState(order.shipment_id ?? '')
  const [date, setDate] = React.useState(order.farm_delivery_date ?? '')
  const [shipDate, setShipDate] = React.useState(order.ship_date ?? '')
  const [incoterm, setIncoterm] = React.useState(order.incoterm)
  const [notes, setNotes] = React.useState(order.notes ?? '')
  const [busy, setBusy] = React.useState(false)
  const current = shipments.find((s) => s.id === order.shipment_id)
  const choices = shipments.filter((s) => s.status === 'open' || s.id === order.shipment_id)
  const dirty =
    shipmentId !== (order.shipment_id ?? '') || date !== (order.farm_delivery_date ?? '') || incoterm !== order.incoterm || notes !== (order.notes ?? '') ||
    shipDate !== (order.ship_date ?? '')

  if (!canEdit)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-5">
            <Detail term="Shipment" value={current ? `${current.shipment_ref} · ${current.flight_no ?? 'flight not set'} · ${formatDate(current.flight_date)}` : 'Not set'} />
            <Detail term="Ship date" value={formatDate(order.ship_date)} />
            <Detail term="Farms deliver on" value={formatDate(order.farm_delivery_date)} />
            <Detail term="Incoterm" value={order.incoterm} />
            <Detail term="Notes" value={order.notes || '—'} />
          </dl>
        </CardContent>
      </Card>
    )

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const flight = shipments.find((s) => s.id === shipmentId)
      await updateOrder(order.id, {
        shipment_id: shipmentId || null,
        // A flight sets the ship date; the farm date follows it unless you changed it too.
        ship_date: (flight?.flight_date ?? shipDate) || null,
        ...(date !== (order.farm_delivery_date ?? '') ? { farm_delivery_date: date || null } : {}),
        incoterm,
        notes: notes.trim() || null,
      })
      toast({
        kind: 'success',
        title: 'Order saved',
        description: incoterm !== order.incoterm ? `Margins were reset to the ${incoterm} rules.` : undefined,
      })
      onSaved()
    } catch (err) {
      toast({ kind: 'error', title: 'Not saved', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field id="order-shipment" label="Shipment" hint="Needed before boxes can be assigned.">
              {(d) => (
                <Select id="order-shipment" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} aria-describedby={d}>
                  <option value="">Not yet</option>
                  {choices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shipment_ref} · {s.flight_no ?? 'flight not set'} · {formatDate(s.flight_date)}
                      {s.status === 'closed' ? ' (closed)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="order-ship" label="Ship date" hint="Set by the flight when one is chosen.">
              {(d) => <Input id="order-ship" type="date" value={shipDate} disabled={!!shipmentId} onChange={(e) => setShipDate(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="order-delivery" label="Farms deliver on" hint="Worked out from the ship date. New farm POs take it.">
              {(d) => <Input id="order-delivery" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="order-incoterm" label="Incoterm" hint={incoterm !== order.incoterm ? 'Saving resets each line\'s margin to this incoterm\'s rules.' : undefined}>
              {(d) => (
                <Select id="order-incoterm" value={incoterm} onChange={(e) => setIncoterm(e.target.value)} aria-describedby={d}>
                  {[...new Set([order.incoterm, ...(incoterms.data ?? [])])].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="order-notes" label="Notes">
              {(d) => <Input id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} aria-describedby={d} />}
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2">
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => {
                  setShipmentId(order.shipment_id ?? '')
                  setDate(order.farm_delivery_date ?? '')
                  setIncoterm(order.incoterm)
                  setNotes(order.notes ?? '')
                  setShipDate(order.ship_date ?? '')
                }}
              >
                Undo changes
              </Button>
            )}
            <Button type="submit" disabled={!dirty || busy}>
              {busy ? 'Saving…' : 'Save details'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-muted-foreground">{term}</dt>
      <dd>{value}</dd>
    </div>
  )
}
