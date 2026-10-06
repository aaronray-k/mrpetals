import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMyOrders } from '~/lib/ordering/api'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { OrderStage } from '~/components/shop/order-progress'
import { formatDate } from '~/components/orders/shipment-status'
import { Alert } from '~/components/ui/alert'
import { buttonVariants } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export const Route = createFileRoute('/_app/my-orders/')({
  head: () => ({ meta: [{ title: 'My orders · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/my-orders')}>
      <MyOrdersPage />
    </RequireRole>
  ),
})

function MyOrdersPage() {
  const orders = useMyOrders()
  return (
    <>
      <PageHeader
        title="My orders"
        description="Every order and where it is now."
        actions={
          <Link to="/shop" className={buttonVariants()}>
            <Plus aria-hidden="true" /> New order
          </Link>
        }
      />
      {orders.isLoading && <Spinner />}
      {orders.error && <Alert variant="destructive" title="Couldn't load your orders" role="alert">{(orders.error as Error).message}</Alert>}
      {orders.data && (
        <div className="rounded-lg border bg-card">
          <Table>
            <caption className="sr-only">My orders</caption>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Ship date</TH>
                <TH className="text-right">Stems</TH>
                <TH>Where it is</TH>
                <TH>Payment</TH>
              </TR>
            </THead>
            <TBody>
              {orders.data.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link to="/my-orders/$orderId" params={{ orderId: o.id }} className="inline-flex min-h-6 items-center font-semibold underline-offset-2 hover:underline">
                      {o.order_number}
                    </Link>
                    {o.standing_order_id && <span className="block text-sm text-muted-foreground">Standing order</span>}
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(o.ship_date)}</TD>
                  <TD className="text-right tabular-nums">{o.progress?.stems.toLocaleString('en-GB') ?? '—'}</TD>
                  <TD>
                    <OrderStage progress={o.progress} />
                  </TD>
                  <TD>{o.progress?.payment_status === 'paid' ? 'Paid' : 'Not paid yet'}</TD>
                </TR>
              ))}
              {orders.data.length === 0 && (
                <TR>
                  <TD colSpan={5} className="text-muted-foreground">
                    No orders yet. Start in the catalog.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </div>
      )}
    </>
  )
}
