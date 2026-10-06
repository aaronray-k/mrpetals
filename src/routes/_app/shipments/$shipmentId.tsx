import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, Lock } from 'lucide-react'
import {
  closeShipment,
  productLabel,
  shipmentKeys,
  useBuyerDirectory,
  useFarmNames,
  useProductNames,
  useReferenceData,
  useShipment,
  type Box,
  type Order,
  type Shipment,
} from '~/lib/orders/api'
import { downloadOrderSheet } from '~/lib/orders/download-sheet'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { BoxesTable } from '~/components/orders/boxes-table'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'
import { ShipmentStatus, formatDate } from '~/components/orders/shipment-status'

export const Route = createFileRoute('/_app/shipments/$shipmentId')({
  head: () => ({ meta: [{ title: 'Shipment · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/shipments')}>
      <ShipmentPage />
    </RequireRole>
  ),
})

function ShipmentPage() {
  const { shipmentId } = Route.useParams()
  const { roles } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const q = useShipment(shipmentId)
  const buyers = useBuyerDirectory()
  const farms = useFarmNames()
  const products = useProductNames()
  const [closing, setClosing] = React.useState(false)

  const staff = hasAnyRole(roles, STAFF_ROLES)
  const can = {
    receive: staff,
    qc: hasAnyRole(roles, ['admin', 'consolidator', 'qc']),
    print: hasAnyRole(roles, ['admin', 'consolidator', 'qc']),
    void: staff,
  }
  const refresh = () => void queryClient.invalidateQueries({ queryKey: shipmentKeys.one(shipmentId) })

  if (q.isLoading) return <Spinner />
  if (q.error) return <Alert variant="destructive" title="Couldn't load this shipment" role="alert">{(q.error as Error).message}</Alert>
  if (!q.data?.shipment) return <Alert variant="warning" title="This shipment doesn't exist" role="alert" />
  const { shipment, orders, boxes } = q.data

  const farmName = (id: string) => farms.data?.find((f) => f.id === id)?.farm_name ?? 'Farm'
  const productName = (id: string) => {
    const p = products.data?.find((x) => x.id === id)
    return p ? productLabel(p) : 'Product'
  }
  const buyerIds = [...new Set([...orders.map((o) => o.customer_id), ...boxes.map((b) => b.customer_id)])]
  const buyerName = (id: string) => buyers.data?.find((b) => b.id === id)
  const active = boxes.filter((b) => b.status === 'active')
  const unprinted = active.filter((b) => !b.last_printed_at).length

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <Link to="/shipments" className="inline-flex min-h-6 items-center justify-self-start text-sm font-semibold text-muted-foreground hover:text-foreground">
            ← All shipments
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-3xl font-bold tracking-tight text-primary dark:text-foreground">
            {shipment.shipment_ref} <ShipmentStatus status={shipment.status} />
          </h1>
          <p className="text-muted-foreground">
            {shipment.flight_no ?? 'Flight not set'} · {formatDate(shipment.flight_date)} · {shipment.origin_airport} → {shipment.destination_airport ?? '?'}
            {shipment.mawb && <> · MAWB {shipment.mawb}</>}
          </p>
        </div>
        {staff && shipment.status === 'open' && (
          <Button variant="outline" onClick={() => setClosing(true)}>
            <Lock aria-hidden="true" /> Close shipment
          </Button>
        )}
      </div>

      <Tip id="shipments.detail" title="From boxes to labels">
        Tick boxes as they arrive (<strong>Received</strong>), record <strong>QC</strong>, then <strong>Print labels</strong> for boxes
        that passed. A box that drops out is <strong>voided</strong>: it keeps its id, and the boxes after it move up a number
        until the shipment is closed.
      </Tip>

      {buyerIds.length === 0 && (
        <Card className="p-6">
          <p className="font-bold">No orders on this shipment yet</p>
          <p className="text-muted-foreground">Choose this shipment on an order, then assign boxes to its confirmed farm POs.</p>
        </Card>
      )}

      {buyerIds.map((buyerId) => {
        const buyer = buyerName(buyerId)
        const buyerBoxes = boxes.filter((b) => b.customer_id === buyerId)
        const buyerOrders = orders.filter((o) => o.customer_id === buyerId)
        return (
          <BuyerSection
            key={buyerId}
            shipment={shipment}
            buyerLabel={buyer ? `${buyer.company_name} (${buyer.customer_code})` : 'Buyer'}
            buyerCode={buyer?.customer_code ?? 'buyer'}
            buyerId={buyerId}
            orders={buyerOrders}
            boxes={buyerBoxes}
            can={can}
            canDownload={hasAnyRole(roles, ['admin', 'consolidator', 'finance'])}
            farmName={farmName}
            productName={productName}
            onChanged={refresh}
          />
        )
      })}

      <Dialog
        open={closing}
        onClose={() => setClosing(false)}
        title={`Close ${shipment.shipment_ref}?`}
        description="Box numbers are frozen when the shipment closes: voiding a box after that leaves a gap. No more boxes can be added."
      >
        <div className="grid gap-4">
          {unprinted > 0 && (
            <Alert variant="warning" title={`${unprinted} ${unprinted === 1 ? 'box has' : 'boxes have'} no label yet`}>
              You can still print them after closing.
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  await closeShipment(shipment.id)
                  toast({ kind: 'success', title: `${shipment.shipment_ref} closed`, description: 'Box numbers are now frozen.' })
                  setClosing(false)
                  refresh()
                  void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
                } catch (e) {
                  toast({ kind: 'error', title: 'Not closed', description: (e as Error).message })
                }
              }}
            >
              <Lock aria-hidden="true" /> Close shipment
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function BuyerSection({
  shipment,
  buyerLabel,
  buyerCode,
  buyerId,
  orders,
  boxes,
  can,
  canDownload,
  farmName,
  productName,
  onChanged,
}: {
  shipment: Shipment
  buyerLabel: string
  buyerCode: string
  buyerId: string
  orders: Order[]
  boxes: Box[]
  can: { receive: boolean; qc: boolean; print: boolean; void: boolean }
  canDownload: boolean
  farmName: (id: string) => string
  productName: (id: string) => string
  onChanged: () => void
}) {
  const toast = useToast()
  const ref = useReferenceData()
  const active = boxes.filter((b) => b.status === 'active')
  const count = (pick: (b: Box) => boolean) => active.filter(pick).length

  async function download(order: Order, withPrices: boolean) {
    const buyer = ref.data?.buyers.find((b) => b.id === buyerId)
    if (!buyer) {
      toast({ kind: 'error', title: 'Buyer details are not available to you' })
      return
    }
    try {
      await downloadOrderSheet(order, buyer, shipment, withPrices)
      toast({ kind: 'success', title: withPrices ? 'Proforma downloaded' : 'Packing list downloaded' })
    } catch (e) {
      toast({ kind: 'error', title: 'Download failed', description: (e as Error).message })
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{buyerLabel}</CardTitle>
            <CardDescription>
              {active.length} boxes · {count((b) => !!b.received_at)} received · {count((b) => b.qc_status === 'passed')} passed QC ·{' '}
              {count((b) => !!b.last_printed_at)} labelled
            </CardDescription>
          </div>
        </div>
        {orders.length > 0 && (
          <ul className="grid gap-2">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                {canDownload ? (
                  <Link to="/orders/$orderId" params={{ orderId: o.id }} className="inline-flex min-h-6 items-center font-semibold underline-offset-2 hover:underline">
                    Order {o.order_number}
                  </Link>
                ) : (
                  <span className="font-semibold">Order {o.order_number}</span>
                )}
                {canDownload && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => download(o, true)}>
                      <FileSpreadsheet aria-hidden="true" /> Proforma
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => download(o, false)}>
                      <FileSpreadsheet aria-hidden="true" /> Packing list
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardHeader>
      <CardContent>
        {boxes.length === 0 ? (
          <p className="text-muted-foreground">No boxes yet. Assign boxes on the order's confirmed farm POs.</p>
        ) : (
          <BoxesTable
            boxes={boxes}
            farmName={farmName}
            productName={productName}
            can={can}
            fileBase={`${shipment.shipment_ref}-${buyerCode}`}
            onChanged={onChanged}
          />
        )}
      </CardContent>
    </Card>
  )
}
