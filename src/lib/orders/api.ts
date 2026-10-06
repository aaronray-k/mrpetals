import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import type { Coverage } from '~/lib/ordering/api'

/** Database functions return errors as plain messages already written for people. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Shipment {
  id: string
  shipment_ref: string
  mawb: string | null
  status: 'open' | 'closed'
  flight_no: string | null
  flight_date: string | null
  origin_airport: string
  destination_airport: string | null
  closed_at: string | null
}

export interface BuyerRef {
  id: string
  customer_code: string
  company_name: string
  incoterm: string
  currency: string
  country: string
  city: string | null
  delivery_address: string | null
  destination_airport: string
}

export interface FarmRef {
  id: string
  farm_code: string
  farm_name: string
}

export interface ProductRef {
  id: string
  product_code: string
  flower_type: string
  variety: string
  colour: string | null
  grade: string
  stem_length_cm: number
  stems_per_bunch: number
  default_farm_id: string | null
}

export interface PackRateRef {
  product_id: string
  box_type_id: string
  bunches_per_box: number
  box_types: { box_code: string } | null
}

export interface Order {
  id: string
  order_number: string
  customer_id: string
  shipment_id: string | null
  incoterm: string
  currency: string
  farm_delivery_date: string | null
  status: 'submitted' | 'open' | 'cancelled' | 'declined'
  notes: string | null
  created_at: string
  ship_date: string | null
  payment_status: 'unpaid' | 'paid'
  payment_reference: string | null
  decline_reason: string | null
  flight_note: string | null
  packing_list_at: string | null
  source: 'self_order' | 'staff'
  standing_order_id: string | null
}

export interface OrderLine {
  id: string
  order_id: string
  line_no: number
  product_id: string
  stems: number
  margin_per_stem: number | null
  notes: string | null
  bunching: 'standard' | 'custom' | 'consolflora'
  stems_per_bunch: number | null
  sleeves: boolean | null
  bunch_labels: boolean | null
  quoted_price_per_stem: number | null
}

export interface PurchaseOrder {
  id: string
  po_number: string
  order_id: string
  farm_id: string
  delivery_date: string | null
  status: 'draft' | 'sent' | 'confirmed' | 'declined' | 'cancelled'
  cancel_reason: string | null
  answer_log: { at: string; short: { product: string; asked: number; confirmed: number }[]; note: string | null }[]
  sent_at: string | null
  responded_at: string | null
  decline_reason: string | null
  boxes_assigned_at: string | null
}

export interface PoLine {
  id: string
  po_id: string
  order_line_id: string
  product_id: string
  box_type_id: string
  stems: number
  stems_per_box: number
  grower_price_per_stem: number | null
  requested_stems: number | null
}

export interface OrderCharge {
  id: string
  order_id: string
  description: string
  amount: number
  sort_order: number
}

export interface Box {
  id: number
  po_line_id: string
  shipment_id: string
  customer_id: string
  farm_id: string
  product_id: string
  stems: number
  status: 'active' | 'void' | 'back_to_farm'
  void_reason: string | null
  received_at: string | null
  qc_status: 'pending' | 'passed' | 'failed'
  qc_severity: 'minor' | 'major' | 'critical' | null
  qc_reasons: string[]
  qc_note: string | null
  buyer_box_no: number | null
  buyer_box_total: number | null
  farm_box_no: number | null
  farm_box_total: number | null
  last_printed_at: string | null
  last_print_kind: 'print' | 'reprint' | null
  label_out_of_date: boolean
  /** Scanned at QC at least once. */
  scanned: boolean
  photo_count: number
}

export interface MarginRule {
  id: string
  incoterm: string
  flower_type: string | null
  min_length_cm: number
  max_length_cm: number | null
  margin_per_stem: number
  active: boolean
}

export interface PackingListRow {
  order_id: string
  order_number: string
  po_number: string
  farm_name: string
  line_no: number
  notes: string | null
  margin_per_stem: number | null
  stems_per_box: number
  grower_price_per_stem: number | null
  product_code: string
  flower_type: string
  variety: string
  colour: string | null
  stem_length_cm: number
  boxes: number
  stems: number
  box_numbers: number[] | null
}

const num = (v: unknown) => (v == null ? null : Number(v))

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export function useReferenceData() {
  return useQuery({
    queryKey: ['order-reference-data'],
    queryFn: async () => {
      const supabase = getSupabase()
      const [buyers, farms, products, packRates] = await Promise.all([
        rows<BuyerRef>(
          supabase
            .from('customers')
            .select('id, customer_code, company_name, incoterm, currency, country, city, delivery_address, destination_airport')
            .eq('active', true)
            .order('company_name'),
        ),
        rows<FarmRef>(supabase.from('farms').select('id, farm_code, farm_name').eq('active', true).order('farm_name')),
        rows<ProductRef>(
          supabase
            .from('products')
            .select('id, product_code, flower_type, variety, colour, grade, stem_length_cm, stems_per_bunch, default_farm_id')
            .eq('active', true)
            .order('flower_type')
            .order('variety')
            .order('stem_length_cm'),
        ),
        rows<PackRateRef>(supabase.from('pack_rates').select('product_id, box_type_id, bunches_per_box, box_types(box_code)')),
      ])
      return { buyers, farms, products, packRates }
    },
    staleTime: 60_000,
  })
}

export function productLabel(p: Pick<ProductRef, 'flower_type' | 'variety' | 'stem_length_cm' | 'grade'>) {
  return `${p.variety} · ${p.flower_type} · ${p.stem_length_cm} cm · ${p.grade}`
}

/** Buyer names only (safe for QC); see the buyer_directory view. */
export function useBuyerDirectory() {
  return useQuery({
    queryKey: ['buyer-directory'],
    queryFn: () => rows<{ id: string; customer_code: string; company_name: string }>(getSupabase().from('buyer_directory').select('*')),
    staleTime: 60_000,
  })
}

/** Farm names for QC and staff (farms the user may read). */
export function useFarmNames() {
  return useQuery({
    queryKey: ['farm-names'],
    queryFn: () => rows<FarmRef>(getSupabase().from('farms').select('id, farm_code, farm_name')),
    staleTime: 60_000,
  })
}

export function useProductNames() {
  return useQuery({
    queryKey: ['product-names'],
    queryFn: () =>
      rows<ProductRef>(
        getSupabase().from('products').select('id, product_code, flower_type, variety, colour, grade, stem_length_cm, stems_per_bunch, default_farm_id'),
      ),
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

export const shipmentKeys = { all: ['shipments'] as const, one: (id: string) => ['shipments', id] as const }

export function useShipments() {
  return useQuery({
    queryKey: shipmentKeys.all,
    queryFn: () =>
      rows<Shipment>(
        getSupabase()
          .from('shipments')
          .select('id, shipment_ref, mawb, status, flight_no, flight_date, origin_airport, destination_airport, closed_at')
          .order('flight_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }),
      ),
  })
}

export function useShipment(id: string) {
  return useQuery({
    queryKey: shipmentKeys.one(id),
    enabled: !!id,
    queryFn: async () => {
      const supabase = getSupabase()
      const [shipment, orders, boxes] = await Promise.all([
        supabase
          .from('shipments')
          .select('id, shipment_ref, mawb, status, flight_no, flight_date, origin_airport, destination_airport, closed_at')
          .eq('id', id)
          .maybeSingle(),
        rows<Order>(supabase.from('customer_orders').select('*').eq('shipment_id', id).order('order_number')),
        rows<Box>(supabase.from('box_overview').select('*').eq('shipment_id', id).order('customer_id').order('id')),
      ])
      if (shipment.error) throw new Error(shipment.error.message)
      return { shipment: shipment.data as Shipment | null, orders, boxes: boxes.map(normaliseBox) }
    },
  })
}

function normaliseBox(b: Box): Box {
  return { ...b, id: Number(b.id) }
}

export async function createShipment(input: {
  shipment_ref: string
  flight_no: string | null
  flight_date: string | null
  destination_airport: string | null
  mawb: string | null
}) {
  const { data, error } = await getSupabase().from('shipments').insert(input).select('id').single()
  if (error) {
    throw new Error(error.code === '23505' ? `Shipment ${input.shipment_ref} already exists.` : error.message)
  }
  return data.id as string
}

export const closeShipment = (id: string) => rpc<void>('close_shipment', { p_shipment_id: id })

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orderKeys = { all: ['orders'] as const, one: (id: string) => ['orders', id] as const }

export interface OrderSummary extends Order {
  stems: number
  allocated: number
  pos: { status: PurchaseOrder['status']; boxes_assigned_at: string | null }[]
}

export function useOrders() {
  return useQuery({
    queryKey: orderKeys.all,
    queryFn: async (): Promise<OrderSummary[]> => {
      const supabase = getSupabase()
      const [orders, lines, pos, poLines] = await Promise.all([
        rows<Order>(supabase.from('customer_orders').select('*').order('created_at', { ascending: false })),
        rows<OrderLine>(supabase.from('customer_order_lines').select('id, order_id, stems')),
        rows<PurchaseOrder>(supabase.from('purchase_orders').select('id, order_id, status, boxes_assigned_at')),
        rows<PoLine>(supabase.from('purchase_order_lines').select('order_line_id, stems')),
      ])
      const lineOrder = new Map(lines.map((l) => [l.id, l.order_id]))
      return orders.map((o) => ({
        ...o,
        stems: lines.filter((l) => l.order_id === o.id).reduce((s, l) => s + l.stems, 0),
        allocated: poLines.filter((p) => lineOrder.get(p.order_line_id) === o.id).reduce((s, p) => s + p.stems, 0),
        pos: pos.filter((p) => p.order_id === o.id),
      }))
    },
  })
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: orderKeys.one(id),
    queryFn: async () => {
      const supabase = getSupabase()
      const [order, lines, pos, charges, coverage] = await Promise.all([
        supabase.from('customer_orders').select('*').eq('id', id).maybeSingle(),
        rows<OrderLine>(supabase.from('customer_order_lines').select('*').eq('order_id', id).order('line_no')),
        rows<PurchaseOrder>(supabase.from('purchase_orders').select('*').eq('order_id', id).order('po_number')),
        rows<OrderCharge>(supabase.from('order_charges').select('*').eq('order_id', id).order('sort_order').order('created_at')),
        rows<Coverage>(supabase.from('order_line_coverage').select('*').eq('order_id', id)),
      ])
      if (order.error) throw new Error(order.error.message)
      const poIds = pos.map((p) => p.id)
      const poLines = poIds.length ? await rows<PoLine>(supabase.from('purchase_order_lines').select('*').in('po_id', poIds)) : []
      const lineIds = poLines.map((l) => l.id)
      const boxRows = lineIds.length
        ? await rows<Pick<Box, 'id' | 'po_line_id' | 'status'>>(supabase.from('boxes').select('id, po_line_id, status').in('po_line_id', lineIds))
        : []
      return {
        order: order.data as Order | null,
        lines: lines.map((l) => ({ ...l, margin_per_stem: num(l.margin_per_stem), quoted_price_per_stem: num(l.quoted_price_per_stem) })),
        pos,
        poLines: poLines.map((l) => ({ ...l, grower_price_per_stem: num(l.grower_price_per_stem) })),
        charges: charges.map((c) => ({ ...c, amount: Number(c.amount) })),
        coverage,
        boxes: boxRows,
      }
    },
  })
}

export const createOrder = (input: {
  customerId: string
  shipmentId: string | null
  farmDeliveryDate: string | null
  lines: { product_id: string; stems: number; notes?: string }[]
  notes?: string
}) =>
  rpc<{ order_id: string; order_number: string }>('create_customer_order', {
    p_customer_id: input.customerId,
    p_shipment_id: input.shipmentId,
    p_farm_delivery_date: input.farmDeliveryDate,
    p_lines: input.lines,
    p_notes: input.notes ?? null,
  })

export async function updateOrder(id: string, patch: Partial<Pick<Order, 'shipment_id' | 'farm_delivery_date' | 'incoterm' | 'notes' | 'ship_date'>>) {
  const { error } = await getSupabase().from('customer_orders').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateOrderLine(id: string, patch: Partial<Pick<OrderLine, 'margin_per_stem' | 'notes'>>) {
  const { error } = await getSupabase().from('customer_order_lines').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function addCharge(orderId: string, description: string, amount: number, sortOrder: number) {
  const { error } = await getSupabase().from('order_charges').insert({ order_id: orderId, description, amount, sort_order: sortOrder })
  if (error) throw new Error(error.message)
}

export async function removeCharge(id: string) {
  const { error } = await getSupabase().from('order_charges').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export const allocateLine = (input: { orderLineId: string; farmId: string; stems: number; boxTypeId: string | null; stemsPerBox: number | null }) =>
  rpc<string>('allocate_order_line', {
    p_order_line_id: input.orderLineId,
    p_farm_id: input.farmId,
    p_stems: input.stems,
    p_box_type_id: input.boxTypeId,
    p_stems_per_box: input.stemsPerBox,
  })

export const removeAllocation = (poLineId: string) => rpc<void>('remove_allocation', { p_po_line_id: poLineId })
export const setGrowerPrice = (poLineId: string, price: number) => rpc<void>('set_grower_price', { p_po_line_id: poLineId, p_price: price })
export const sendPo = (poId: string) => rpc<void>('send_purchase_order', { p_po_id: poId })
export const respondPo = (poId: string, accept: boolean, reason?: string) =>
  rpc<void>('respond_purchase_order', { p_po_id: poId, p_accept: accept, p_reason: reason ?? null })
export const assignBoxes = (poId: string) => rpc<number>('assign_boxes', { p_po_id: poId })

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

export const voidBox = (boxId: number, reason: string) => rpc<void>('void_box', { p_box_id: boxId, p_reason: reason })
export const receiveBoxes = (ids: number[]) => rpc<number>('receive_boxes', { p_box_ids: ids })
export interface PrintRow {
  box_id: number
  kind: 'print' | 'reprint'
  template_version_id: string
  width_mm: number
  height_mm: number
  orientation: 'normal' | 'rotated'
  layout: unknown
  data: Record<string, unknown>
}
export const printLabelsRpc = (ids: number[], reason: string | null) =>
  rpc<PrintRow[]>('print_labels', { p_box_ids: ids, p_reason: reason })

// ---------------------------------------------------------------------------
// Farm view
// ---------------------------------------------------------------------------

export function useFarmPurchaseOrders() {
  return useQuery({
    queryKey: ['farm-pos'],
    queryFn: async () => {
      const supabase = getSupabase()
      const [pos, lines] = await Promise.all([
        rows<PurchaseOrder>(supabase.from('purchase_orders').select('*').order('delivery_date', { ascending: true, nullsFirst: false })),
        rows<PoLine & { products: ProductRef | null; box_types: { box_code: string } | null }>(
          supabase
            .from('purchase_order_lines')
            .select('*, products(id, product_code, flower_type, variety, colour, grade, stem_length_cm, stems_per_bunch, default_farm_id), box_types(box_code)'),
        ),
      ])
      return pos.map((po) => ({ ...po, lines: lines.filter((l) => l.po_id === po.id) }))
    },
  })
}

// ---------------------------------------------------------------------------
// Margins and packing lists
// ---------------------------------------------------------------------------

export function useMarginRules() {
  return useQuery({
    queryKey: ['margin-rules'],
    queryFn: async () =>
      (
        await rows<MarginRule>(
          getSupabase().from('margin_rules').select('*').order('incoterm').order('flower_type', { nullsFirst: true }).order('min_length_cm'),
        )
      ).map((r) => ({ ...r, margin_per_stem: Number(r.margin_per_stem) })),
  })
}

export async function saveMarginRule(rule: Omit<MarginRule, 'id'> & { id?: string }) {
  const supabase = getSupabase()
  const { id, ...fields } = rule
  const { error } = id ? await supabase.from('margin_rules').update(fields).eq('id', id) : await supabase.from('margin_rules').insert(fields)
  if (error) throw new Error(error.message)
}

export function useIncoterms() {
  return useQuery({
    queryKey: ['incoterms'],
    queryFn: async () =>
      (await rows<{ value: string }>(getSupabase().from('lookup_values').select('value').eq('list_name', 'Incoterm').eq('active', true).order('sort_order'))).map(
        (r) => r.value,
      ),
  })
}

export async function fetchCharges(orderId: string) {
  return (await rows<OrderCharge>(getSupabase().from('order_charges').select('*').eq('order_id', orderId).order('sort_order'))).map((c) => ({
    ...c,
    amount: Number(c.amount),
  }))
}

export async function fetchPackingList(orderId: string) {
  return (await rows<PackingListRow>(getSupabase().from('order_packing_list').select('*').eq('order_id', orderId))).map((r) => ({
    ...r,
    margin_per_stem: num(r.margin_per_stem),
    grower_price_per_stem: num(r.grower_price_per_stem),
  }))
}
