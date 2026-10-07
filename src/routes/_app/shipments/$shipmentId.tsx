import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, Lock, ScanLine } from 'lucide-react'
import {
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
import { closeShipmentWithOverride, useShipmentRelease } from '~/lib/ordering/api'
import { pushToOdoo, useInvoices } from '~/lib/odoo/api'
import { InvoiceLines } from '~/components/odoo/invoice-status'
import { ReleasePanel, ShipmentDetailsForm } from '~/components/shipments/release-panel'
import { useAuth } from '~/lib/auth'
import { QC_CLEAR_ROLES, QC_ROLES, STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { BoxesTable } from '~/components/orders/boxes-table'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button, buttonVariants } from '~/components/ui/button'
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

/** The scan page opens on this shipment. */
function rememberScanShipment(id: string) {
  try {
    localStorage.setItem('qc.shipment', id)
  } catch {
    /* not remembered; the scan page asks */
  }
}

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
  const [overrideReason, setOverrideReason] = React.useState('')

  const staff = hasAnyRole(roles, STAFF_ROLES)
  const can = {
    receive: staff,
    qc: hasAnyRole(roles, QC_ROLES),
    clearQc: hasAnyRole(roles, QC_CLEAR_ROLES),
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
        <div className="flex flex-wrap gap-2">
          {can.qc && (
            <Link to="/qc/scan" className={buttonVariants({ variant: 'outline' })} onClick={() => rememberScanShipment(shipment.id)}>
              <ScanLine aria-hidden="true" /> Scan boxes
            </Link>
          )}
          {staff && shipment.status === 'open' && (
            <Button variant="outline" onClick={() => setClosing(true)}>
              <Lock aria-hidden="true" /> Close shipment
            </Button>
          )}
        </div>
      </div>

      <Tip id="shipments.detail" title="From boxes to labels">
        Tick boxes as they arrive (<strong>Received</strong>), record <strong>QC</strong>, then <strong>Print labels</strong> for boxes
        that passed. A box that drops out is <strong>voided</strong>: it keeps its id, and the boxes after it move up a number
        until the shipment is closed.
      </Tip>

      {shipment.status === 'closed' && hasAnyRole(roles, ['admin', 'consolidator', 'finance']) && <ShipmentInvoices shipmentId={shipment.id} />}
      <ShipmentDetailsForm key={`${shipment.mawb}-${shipment.flight_no}-${shipment.flight_date}-${shipment.destination_airport}-${shipment.arrived_at}`} shipment={shipment} canEdit={staff} onSaved={() => void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })} />
      {hasAnyRole(roles, ['admin', 'consolidator', 'finance']) && (
        <ReleasePanel
          shipmentId={shipment.id}
          buyerName={(id) => {
            const b = buyerName(id)
            return b ? `${b.company_name} (${b.customer_code})` : 'Buyer'
          }}
          canEdit={hasAnyRole(roles, ['admin', 'consolidator', 'finance'])}
          onChanged={refresh}
        />
      )}

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
          <CloseBlockers shipmentId={shipment.id} isAdmin={hasAnyRole(roles, ['admin'])} reason={overrideReason} onReason={setOverrideReason} />
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
                  await closeShipmentWithOverride(shipment.id, overrideReason.trim() || null)
                  toast({ kind: 'success', title: `${shipment.shipment_ref} closed`, description: 'Box numbers are now frozen. Invoices are going to Odoo.' })
                  // One invoice per buyer was made on closing; send them to Odoo now (failures wait on the Invoices page).
                  void pushToOdoo({ shipmentId: shipment.id })
                    .then((r) => {
                      if (r.failed) toast({ kind: 'error', title: `${r.failed} invoices didn't reach Odoo`, description: 'See the Invoices page.' })
                      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
                    })
                    .catch(() => {})
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
  can: { receive: boolean; qc: boolean; print: boolean; void: boolean; clearQc: boolean }
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

/** What still blocks closing; an Admin can close anyway with a reason (logged). */
function CloseBlockers({ shipmentId, isAdmin, reason, onReason }: { shipmentId: string; isAdmin: boolean; reason: string; onReason: (r: string) => void }) {
  const q = useShipmentRelease(shipmentId)
  const blockers = q.data?.blockers ?? []
  if (!blockers.length) return null
  return (
    <Alert variant="warning" title="Not cleared yet">
      <ul className="list-disc pl-5">
        {blockers.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {isAdmin ? (
        <div className="mt-3 grid gap-1">
          <label htmlFor="override-reason" className="text-sm font-semibold">
            Close anyway: reason (Admin, logged)
          </label>
          <textarea id="override-reason" rows={2} value={reason} onChange={(e) => onReason(e.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-base" />
        </div>
      ) : (
        <p className="mt-2">Clear these first, or ask an Admin to close it anyway.</p>
      )}
    </Alert>
  )
}

function ShipmentInvoices({ shipmentId }: { shipmentId: string }) {
  const invoices = useInvoices({ shipmentId })
  if (!invoices.data?.length) return null
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Invoices in Odoo</CardTitle>
      </CardHeader>
      <CardContent>
        <InvoiceLines invoices={invoices.data} showBuyer />
      </CardContent>
    </Card>
  )
}
