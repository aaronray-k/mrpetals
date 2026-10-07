import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { getSupabase } from '~/lib/supabase'
import { orderProgress } from '~/lib/ordering/api'
import { productLabel, useProductNames } from '~/lib/orders/api'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { OrderTimeline } from '~/components/shop/order-progress'
import { money } from '~/components/shop/money'
import { formatDate } from '~/components/orders/shipment-status'
import { useClaimableBoxes } from '~/lib/claims/api'
import { formatDateTime } from '~/lib/utils'
import { Alert } from '~/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export const Route = createFileRoute('/_app/my-orders/$orderId')({
  head: () => ({ meta: [{ title: 'Order · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/my-orders')}>
      <MyOrderPage />
    </RequireRole>
  ),
})

interface Line {
  id: string
  line_no: number
  product_id: string
  stems: number
  bunching: string
  stems_per_bunch: number | null
  sleeves: boolean | null
  bunch_labels: boolean | null
  quoted_price_per_stem: number | null
  notes: string | null
}

const BUNCHING: Record<string, string> = { standard: 'Standard bunching', custom: 'Own bunching', consolflora: 'ConsolFlora decides' }

function MyOrderPage() {
  const { orderId } = Route.useParams()
  const products = useProductNames()
  const claimable = useClaimableBoxes()
  const q = useQuery({
    queryKey: ['my-order', orderId],
    queryFn: async () => {
      const supabase = getSupabase()
      const [order, lines, progress] = await Promise.all([
        supabase.from('customer_orders').select('id, order_number, currency, ship_date, notes, created_at').eq('id', orderId).maybeSingle(),
        supabase.from('customer_order_lines').select('id, line_no, product_id, stems, bunching, stems_per_bunch, sleeves, bunch_labels, quoted_price_per_stem, notes').eq('order_id', orderId).order('line_no'),
        orderProgress(orderId),
      ])
      if (order.error) throw new Error(order.error.message)
      if (lines.error) throw new Error(lines.error.message)
      return { order: order.data, lines: (lines.data ?? []) as Line[], progress }
    },
  })

  if (q.isLoading) return <Spinner />
  if (q.error) return <Alert variant="destructive" title="Couldn't load this order" role="alert">{(q.error as Error).message}</Alert>
  if (!q.data?.order || !q.data.progress) return <Alert variant="warning" title="This order doesn't exist" role="alert" />
  const { order, lines, progress } = q.data
  const name = (id: string) => {
    const p = products.data?.find((x) => x.id === id)
    return p ? productLabel(p) : 'Product'
  }
  const total = lines.reduce((s, l) => s + l.stems * Number(l.quoted_price_per_stem ?? 0), 0)

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-1">
        <Link to="/my-orders" className="inline-flex min-h-6 items-center justify-self-start text-sm font-semibold text-muted-foreground hover:text-foreground">
          ← My orders
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-primary dark:text-foreground">{order.order_number}</h1>
        <p className="text-muted-foreground">
          Ships {formatDate(order.ship_date)} · placed {formatDate(order.created_at.slice(0, 10))} · {progress.payment_status === 'paid' ? 'paid' : 'not paid yet'}
        </p>
      </div>
      {(() => {
        const box = claimable.data?.find((b) => b.order_number === order.order_number)
        return (
          box && (
            <Alert variant="warning" title="Something wrong with these flowers?">
              You can report a problem until {formatDateTime(box.deadline)}.{' '}
              <Link to="/my-claims/new" search={{ shipment: box.shipment_id }} className="font-semibold underline">
                Report a problem
              </Link>
            </Alert>
          )
        )
      })()}
      {progress.flight_note && (
        <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {progress.flight_note}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderTimeline progress={progress} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <caption className="sr-only">Order lines</caption>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="text-right">Stems</TH>
                  <TH>Bunching</TH>
                  <TH className="text-right">Price per stem</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      {name(l.product_id)}
                      {l.notes && <span className="block text-sm text-muted-foreground">{l.notes}</span>}
                    </TD>
                    <TD className="text-right tabular-nums">{l.stems.toLocaleString('en-GB')}</TD>
                    <TD>
                      {BUNCHING[l.bunching]}
                      {l.bunching === 'custom' && (
                        <span className="block text-sm text-muted-foreground">
                          {l.stems_per_bunch} per bunch{l.sleeves ? ', sleeves' : ''}
                          {l.bunch_labels ? ', bunch labels' : ''}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{l.quoted_price_per_stem == null ? '—' : money(Number(l.quoted_price_per_stem), order.currency, 3)}</TD>
                    <TD className="text-right tabular-nums">{l.quoted_price_per_stem == null ? '—' : money(l.stems * Number(l.quoted_price_per_stem), order.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {total > 0 && (
            <p className="mt-3 text-right">
              Flowers: <strong>{money(total, order.currency)}</strong>
              <span className="block text-sm text-muted-foreground">The proforma invoice adds other costs.</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
