import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ClipboardList, Plus, Search } from 'lucide-react'
import { useBuyerDirectory, useOrders, useShipments } from '~/lib/orders/api'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { formatDate } from '~/components/orders/shipment-status'
import { OrderStatusBadge } from '~/components/orders/order-actions'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { buttonVariants } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input, Label } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export const Route = createFileRoute('/_app/orders/')({
  head: () => ({ meta: [{ title: 'Orders · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/orders')}>
      <OrdersPage />
    </RequireRole>
  ),
})

function OrdersPage() {
  const { roles } = useAuth()
  const orders = useOrders()
  const buyers = useBuyerDirectory()
  const shipments = useShipments()
  const [search, setSearch] = React.useState('')
  const staff = hasAnyRole(roles, STAFF_ROLES)
  const buyerName = (id: string) => buyers.data?.find((b) => b.id === id)?.company_name ?? ''
  const shipment = (id: string | null) => shipments.data?.find((s) => s.id === id)
  const term = search.trim().toLowerCase()
  const [status, setStatus] = React.useState('all')
  const list = (orders.data ?? []).filter(
    (o) => (!term || `${o.order_number} ${buyerName(o.customer_id)}`.toLowerCase().includes(term)) && (status === 'all' || o.status === status),
  )
  const waiting = (orders.data ?? []).filter((o) => o.status === 'submitted').length

  return (
    <>
      <PageHeader
        title="Orders"
        description="Buyer orders in stems. Split each line across farms; each farm gets its own PO."
        actions={
          staff && (
            <Link to="/orders/new" className={buttonVariants()}>
              <Plus aria-hidden="true" /> New order
            </Link>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="orders.list" title="From order to boxes">
          Open an order and <strong>add farms</strong> to each line. Send each farm its PO; once the farm confirms,{' '}
          <strong>Assign boxes</strong> turns its stems into boxes on the order's shipment.
        </Tip>
        <div className="grid gap-1.5 sm:max-w-sm">
          <Label htmlFor="order-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="order-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Order number or buyer" />
          </div>
        </div>
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Show</legend>
          {[
            ['all', 'All'],
            ['submitted', `Waiting for approval (${waiting})`],
            ['open', 'Approved'],
            ['declined', 'Declined'],
          ].map(([id, label]) => (
            <label key={id} className={`inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${status === id ? 'bg-accent/20' : 'bg-card'}`}>
              <input type="radio" name="order-status" className="sr-only" checked={status === id} onChange={() => setStatus(id!)} />
              {label}
            </label>
          ))}
        </fieldset>
        {orders.isLoading && <Spinner />}
        {orders.error && <Alert variant="destructive" title="Couldn't load orders" role="alert">{(orders.error as Error).message}</Alert>}
        {orders.data?.length === 0 && (
          <Card className="grid justify-items-start gap-2 p-6">
            <ClipboardList className="size-8 text-accent" aria-hidden="true" />
            <p className="text-lg font-bold">No orders yet</p>
            <p className="text-muted-foreground">Orders from the self-order platform appear here. Staff can also enter one for a buyer.</p>
          </Card>
        )}
        {list.length > 0 && (
          <Card>
            <Table>
              <caption className="sr-only">Orders</caption>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Status</TH>
                  <TH>Buyer</TH>
                  <TH>Shipment</TH>
                  <TH>Farm delivery</TH>
                  <TH className="text-right">Stems</TH>
                  <TH>Placed with farms</TH>
                  <TH>Farm POs</TH>
                </TR>
              </THead>
              <TBody>
                {list.map((o) => {
                  const s = shipment(o.shipment_id)
                  const confirmed = o.pos.filter((p) => p.status === 'confirmed').length
                  const placed = o.stems ? Math.round((o.allocated / o.stems) * 100) : 0
                  return (
                    <TR key={o.id}>
                      <TD>
                        <Link to="/orders/$orderId" params={{ orderId: o.id }} className="inline-flex min-h-6 items-center font-semibold underline-offset-2 hover:underline">
                          {o.order_number}
                        </Link>
                      </TD>
                      <TD>
                        <OrderStatusBadge order={o} />
                      </TD>
                      <TD>{buyerName(o.customer_id)}</TD>
                      <TD className="whitespace-nowrap">{s ? `${s.shipment_ref} · ${s.flight_no ?? ''}` : <span className="text-muted-foreground">Not set</span>}</TD>
                      <TD className="whitespace-nowrap">{formatDate(o.farm_delivery_date)}</TD>
                      <TD className="text-right tabular-nums">{o.stems.toLocaleString('en-GB')}</TD>
                      <TD className="whitespace-nowrap">{placed === 100 ? 'All' : `${placed}%`}</TD>
                      <TD className="whitespace-nowrap">{o.pos.length ? `${confirmed} of ${o.pos.length} confirmed` : '—'}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  )
}
