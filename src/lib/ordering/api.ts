import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
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
// Catalog, flights, settings
// ---------------------------------------------------------------------------

export interface CatalogItem {
  product_id: string
  product_code: string
  flower_type: string
  variety: string
  colour: string | null
  grade: string
  stem_length_cm: number
  head_size_cm: number | null
  maturity: string | null
  stems_per_bunch: number
  price_per_stem: number
  currency: string
  farms: number
}

export function useCatalog(customerId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['catalog', customerId ?? 'me'],
    enabled,
    queryFn: async () =>
      (await rpc<CatalogItem[]>('catalog', { p_customer_id: customerId ?? null })).map((c) => ({
        ...c,
        price_per_stem: Number(c.price_per_stem),
        head_size_cm: c.head_size_cm == null ? null : Number(c.head_size_cm),
      })),
  })
}

export interface Flight {
  shipment_id: string
  shipment_ref: string
  flight_no: string | null
  flight_date: string
  destination_airport: string
}

export function useFlights(customerId?: string | null) {
  return useQuery({ queryKey: ['flights', customerId ?? 'me'], queryFn: () => rpc<Flight[]>('available_flights', { p_customer_id: customerId ?? null }) })
}

export interface OrderingSettings {
  min_lead_hours: number
  farm_delivery_hours: number
  standing_order_days_ahead: number
}

export function useOrderingSettings() {
  return useQuery({
    queryKey: ['ordering-settings'],
    queryFn: async () => {
      const [settings, earliest] = await Promise.all([
        rows<OrderingSettings>(getSupabase().from('ordering_settings').select('min_lead_hours, farm_delivery_hours, standing_order_days_ahead')),
        rpc<string>('earliest_ship_date'),
      ])
      return { ...settings[0]!, earliest_ship_date: earliest }
    },
  })
}

export async function saveOrderingSettings(s: OrderingSettings) {
  const { error } = await getSupabase().from('ordering_settings').update(s).eq('id', true)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Cart (kept in this browser until the order is placed)
// ---------------------------------------------------------------------------

export type Bunching = 'standard' | 'custom' | 'consolflora'

export interface CartLine {
  product_id: string
  stems: number
  bunching: Bunching
  stems_per_bunch: number | null
  sleeves: boolean | null
  bunch_labels: boolean | null
  notes: string
}

const CART_KEY = 'consolflora.cart'
const listeners = new Set<() => void>()
let cartCache: CartLine[] | null = null

function readCart(): CartLine[] {
  if (cartCache) return cartCache
  try {
    cartCache = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]') as CartLine[]
  } catch {
    cartCache = []
  }
  return cartCache
}

function writeCart(lines: CartLine[]) {
  cartCache = lines
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(lines))
  } catch {
    /* kept in memory for this visit */
  }
  listeners.forEach((l) => l())
}

const EMPTY: CartLine[] = []

export function useCart() {
  const lines = React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    readCart,
    () => EMPTY,
  )
  return {
    lines,
    /** Adds stems to a product, or the line if it isn't in the cart yet. */
    add(line: CartLine) {
      const existing = lines.find((l) => l.product_id === line.product_id)
      writeCart(existing ? lines.map((l) => (l === existing ? { ...l, stems: l.stems + line.stems } : l)) : [...lines, line])
    },
    update(productId: string, patch: Partial<CartLine>) {
      writeCart(lines.map((l) => (l.product_id === productId ? { ...l, ...patch } : l)))
    },
    remove(productId: string) {
      writeCart(lines.filter((l) => l.product_id !== productId))
    },
    clear() {
      writeCart([])
    },
  }
}

export const placeOrder = (input: { shipmentId: string | null; shipDate: string | null; lines: CartLine[]; notes: string }) =>
  rpc<{ order_id: string; order_number: string; ship_date: string }>('place_order', {
    p_shipment_id: input.shipmentId,
    p_ship_date: input.shipDate,
    p_lines: input.lines.map((l) => ({ ...l, notes: l.notes.trim() || null })),
    p_notes: input.notes,
  })

// ---------------------------------------------------------------------------
// Buyer orders and progress
// ---------------------------------------------------------------------------

export interface OrderProgress {
  status: 'submitted' | 'open' | 'cancelled' | 'declined'
  submitted_at: string
  approved_at: string | null
  declined_reason: string | null
  stems: number
  confirmed_stems: number
  farms_confirmed: boolean
  packing_list_at: string | null
  boxes: number
  qc_passed: number
  labelled: number
  shipped: boolean
  ship_date: string | null
  flight_note: string | null
  payment_status: 'unpaid' | 'paid'
}

export interface MyOrder {
  id: string
  order_number: string
  status: OrderProgress['status']
  ship_date: string | null
  created_at: string
  shipment_id: string | null
  standing_order_id: string | null
  progress: OrderProgress | null
}

export function useMyOrders() {
  return useQuery({
    queryKey: ['my-orders'],
    queryFn: async () => {
      const orders = await rows<Omit<MyOrder, 'progress'>>(
        getSupabase().from('customer_orders').select('id, order_number, status, ship_date, created_at, shipment_id, standing_order_id').order('created_at', { ascending: false }),
      )
      return Promise.all(orders.map(async (o) => ({ ...o, progress: await rpc<OrderProgress | null>('order_progress', { p_order_id: o.id }) })))
    },
  })
}

export const orderProgress = (orderId: string) => rpc<OrderProgress | null>('order_progress', { p_order_id: orderId })

/** The steps a buyer sees, each done or not. */
export function progressSteps(p: OrderProgress) {
  return [
    { id: 'submitted', label: 'Order placed', done: true },
    { id: 'approved', label: 'Approved by ConsolFlora', done: !!p.approved_at },
    { id: 'farms', label: `Farms confirmed (${p.confirmed_stems.toLocaleString('en-GB')} of ${p.stems.toLocaleString('en-GB')} stems)`, done: p.farms_confirmed },
    { id: 'packing', label: 'Packing list ready', done: !!p.packing_list_at },
    { id: 'qc', label: p.boxes ? `Quality checked (${p.qc_passed} of ${p.boxes} boxes)` : 'Quality checked', done: p.boxes > 0 && p.qc_passed >= p.boxes },
    { id: 'labels', label: 'Labelled', done: p.boxes > 0 && p.labelled >= p.boxes },
    { id: 'shipped', label: 'Shipped', done: p.shipped },
  ]
}

// ---------------------------------------------------------------------------
// Standing orders
// ---------------------------------------------------------------------------

export interface StandingOrder {
  id: string
  customer_id: string
  weekdays: number[]
  starts_on: string
  ends_on: string | null
  active: boolean
  notes: string | null
  standing_order_lines: (Omit<CartLine, 'notes'> & { line_no: number; notes: string | null })[]
  standing_order_skips: { ship_date: string }[]
}

export function useStandingOrders() {
  return useQuery({
    queryKey: ['standing-orders'],
    queryFn: () =>
      rows<StandingOrder>(
        getSupabase()
          .from('standing_orders')
          .select('*, standing_order_lines(*), standing_order_skips(ship_date)')
          .order('created_at'),
      ),
  })
}

export const saveStandingOrder = (input: { id: string | null; customerId: string | null; weekdays: number[]; lines: CartLine[]; active: boolean; notes: string }) =>
  rpc<string>('save_standing_order', {
    p_id: input.id,
    p_customer_id: input.customerId,
    p_weekdays: input.weekdays,
    p_lines: input.lines.map((l) => ({ ...l, notes: l.notes.trim() || null })),
    p_active: input.active,
    p_notes: input.notes,
  })

export const skipStandingWeek = (id: string, shipDate: string, skip: boolean) =>
  rpc<void>('skip_standing_order_week', { p_id: id, p_ship_date: shipDate, p_skip: skip })

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** The next ship dates of a standing order (ISO weekdays, Monday = 1). */
export function nextShipDates(weekdays: number[], count = 6, from = new Date()) {
  const out: string[] = []
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  for (let i = 1; out.length < count && i < 60; i++) {
    const day = new Date(d.getTime() + i * 86400000)
    const iso = ((day.getUTCDay() + 6) % 7) + 1
    if (weekdays.includes(iso)) out.push(day.toISOString().slice(0, 10))
  }
  return out
}

// ---------------------------------------------------------------------------
// Staff: approval, calculator, farm answers, packing list, payment
// ---------------------------------------------------------------------------

export const approveOrder = (orderId: string) => rpc<void>('approve_order', { p_order_id: orderId })
export const declineOrder = (orderId: string, reason: string) => rpc<void>('decline_order', { p_order_id: orderId, p_reason: reason })
export const createPackingList = (orderId: string) => rpc<number>('create_packing_list', { p_order_id: orderId })
export const markOrderPaid = (orderId: string, reference: string | null) => rpc<void>('mark_order_paid', { p_order_id: orderId, p_reference: reference })
export const markOrderUnpaid = (orderId: string) => rpc<void>('mark_order_unpaid', { p_order_id: orderId })

export interface FarmOption {
  farm_id: string
  farm_code: string
  farm_name: string
  cost_per_stem: number
  sell_per_stem: number
  margin_per_stem: number
  placed_stems: number
  recommended: boolean
  pinned: boolean
}

export function useFarmOptions(orderLineId: string | null) {
  return useQuery({
    queryKey: ['farm-options', orderLineId],
    enabled: !!orderLineId,
    queryFn: async () =>
      (await rpc<FarmOption[]>('line_farm_options', { p_order_line_id: orderLineId })).map((o) => ({
        ...o,
        cost_per_stem: Number(o.cost_per_stem),
        sell_per_stem: Number(o.sell_per_stem),
        margin_per_stem: Number(o.margin_per_stem),
      })),
  })
}

export interface Coverage {
  order_line_id: string
  order_id: string
  line_no: number
  stems: number
  placed: number
  confirmed: number
  short: number
}

export const fetchCoverage = (orderId: string) => rows<Coverage>(getSupabase().from('order_line_coverage').select('*').eq('order_id', orderId))

export interface BuyerCredit {
  customer_id: string
  is_prepaid: boolean
  credit_limit: number | null
  open_value: number
  over_limit: boolean
  currency: string
}

export function useBuyerCredit(customerId: string | null) {
  return useQuery({
    queryKey: ['buyer-credit', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const r = (await rows<BuyerCredit>(getSupabase().from('buyer_credit').select('*').eq('customer_id', customerId!)))[0]
      return r ? { ...r, open_value: Number(r.open_value), credit_limit: r.credit_limit == null ? null : Number(r.credit_limit) } : null
    },
  })
}

/** Farm answer: stems the farm can supply per PO line, and the delivery date. */
export const answerPo = (poId: string, lines: { po_line_id: string; stems: number }[], deliveryDate: string | null, reason: string | null) =>
  rpc<{ status: string; short_stems: number }>('answer_purchase_order', { p_po_id: poId, p_lines: lines, p_delivery_date: deliveryDate, p_reason: reason })

// ---------------------------------------------------------------------------
// Shipment release
// ---------------------------------------------------------------------------

export type DocType = 'phyto' | 'certificate_of_origin' | 'export_entry'
export const DOC_LABELS: Record<DocType, string> = {
  phyto: 'KEPHIS phytosanitary certificate',
  certificate_of_origin: 'Certificate of origin',
  export_entry: 'Customs export entry',
}

export interface ShipmentDocument {
  id: string
  shipment_id: string
  customer_id: string | null
  doc_type: DocType
  reference: string | null
  storage_path: string | null
  status: 'uploaded' | 'approved'
  uploaded_at: string
  approved_at: string | null
}

export interface ReleaseRow {
  shipment_id: string
  customer_id: string | null
  missing_documents: DocType[]
  unchecked_documents: DocType[]
  is_prepaid: boolean
  unpaid_prepaid_orders: string[]
  over_credit_limit: boolean
}

export function useShipmentRelease(shipmentId: string) {
  return useQuery({
    queryKey: ['shipment-release', shipmentId],
    queryFn: async () => {
      const supabase = getSupabase()
      const [release, documents, blockers] = await Promise.all([
        rows<ReleaseRow>(supabase.from('shipment_release').select('*').eq('shipment_id', shipmentId)),
        rows<ShipmentDocument>(supabase.from('shipment_documents').select('*').eq('shipment_id', shipmentId)),
        rpc<string[]>('shipment_blockers', { p_shipment_id: shipmentId }),
      ])
      return { release, documents, blockers }
    },
  })
}

export async function saveShipmentDocument(input: { shipmentId: string; customerId: string | null; docType: DocType; reference: string; file: File | null }) {
  let path: string | null = null
  if (input.file) {
    const ext = (input.file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
    path = `${input.shipmentId}/${input.docType}-${input.customerId ?? 'shipment'}-${crypto.randomUUID()}.${ext}`
    const up = await getSupabase().storage.from('shipment-docs').upload(path, input.file, { contentType: input.file.type || 'application/octet-stream' })
    if (up.error) throw new Error(up.error.message)
  }
  return rpc<string>('save_shipment_document', {
    p_shipment_id: input.shipmentId,
    p_customer_id: input.customerId,
    p_doc_type: input.docType,
    p_reference: input.reference,
    p_storage_path: path,
  })
}

export const approveShipmentDocument = (id: string) => rpc<void>('approve_shipment_document', { p_document_id: id })

export async function openShipmentDocument(path: string) {
  const { data, error } = await getSupabase().storage.from('shipment-docs').download(path)
  if (error || !data) throw new Error(error?.message ?? 'The file is not available.')
  const url = URL.createObjectURL(data)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const closeShipmentWithOverride = (shipmentId: string, reason: string | null) =>
  rpc<void>('close_shipment', { p_shipment_id: shipmentId, p_override_reason: reason })

export async function updateShipment(id: string, patch: { mawb?: string | null; flight_no?: string | null; flight_date?: string | null; destination_airport?: string | null }) {
  const { error } = await getSupabase().from('shipments').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Prices (Admin)
// ---------------------------------------------------------------------------

export interface PriceOverride {
  id: string
  product_id: string
  incoterm: string
  currency: string
  pinned_farm_id: string | null
  sell_price_per_stem: number | null
}

export function usePriceOverrides() {
  return useQuery({
    queryKey: ['price-overrides'],
    queryFn: async () =>
      (await rows<PriceOverride>(getSupabase().from('price_overrides').select('*'))).map((o) => ({
        ...o,
        sell_price_per_stem: o.sell_price_per_stem == null ? null : Number(o.sell_price_per_stem),
      })),
  })
}

export async function savePriceOverride(o: Omit<PriceOverride, 'id'>) {
  const supabase = getSupabase()
  const { error } =
    o.pinned_farm_id == null && o.sell_price_per_stem == null
      ? await supabase.from('price_overrides').delete().eq('product_id', o.product_id).eq('incoterm', o.incoterm).eq('currency', o.currency)
      : await supabase.from('price_overrides').upsert(o, { onConflict: 'product_id,incoterm,currency' })
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface Notification {
  id: string
  kind: string
  subject: string
  body: string | null
  order_id: string | null
  po_id: string | null
  created_at: string
  read_at: string | null
  email_status: string
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => rows<Notification>(getSupabase().from('notifications').select('*').order('created_at', { ascending: false }).limit(100)),
    refetchInterval: 60_000,
  })
}

export const markNotificationsRead = (ids: string[]) => rpc<void>('mark_notifications_read', { p_ids: ids })
