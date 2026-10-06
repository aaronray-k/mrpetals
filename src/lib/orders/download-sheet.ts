import { fetchCharges, fetchPackingList, type BuyerRef, type Order, type Shipment } from './api'
import { downloadProforma } from './excel'

/** Downloads an order's proforma invoice (withPrices) or packing list. Only boxed lines are listed. */
export async function downloadOrderSheet(order: Order, buyer: BuyerRef, shipment: Shipment | null, withPrices: boolean) {
  const [rows, charges] = await Promise.all([fetchPackingList(order.id), fetchCharges(order.id)])
  const boxed = rows.filter((r) => r.boxes > 0)
  if (!boxed.length) throw new Error(`Order ${order.order_number} has no boxes yet. Assign boxes to a confirmed farm PO first.`)
  const unpriced = withPrices ? boxed.filter((r) => r.grower_price_per_stem == null) : []
  if (unpriced.length)
    throw new Error(
      `No grower price for ${unpriced.map((r) => `${r.variety} from ${r.farm_name}`).join(', ')}. Set it on the order, under Lines and farms, then download again.`,
    )
  await downloadProforma({ order, buyer, shipment, rows: boxed, charges, withPrices })
}
