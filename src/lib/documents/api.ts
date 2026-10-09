import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import type { Invoice } from '~/lib/odoo/api'

/** A shipment (one flight) and every document under it: each order's Proforma & Packing List, invoices, credit notes. */
export interface ShipmentRef {
  id: string
  shipment_ref: string
  mawb: string | null
  flight_no: string | null
  flight_date: string | null
  status: 'open' | 'closed'
  destination_airport: string | null
}
const SHIPMENT_FIELDS = 'id, shipment_ref, mawb, flight_no, flight_date, status, destination_airport'

export function useRecentShipments() {
  return useQuery({
    queryKey: ['doc-shipments'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('shipments').select(SHIPMENT_FIELDS).order('flight_date', { ascending: false, nullsFirst: false }).limit(40)
      if (error) throw new Error(error.message)
      return data as ShipmentRef[]
    },
  })
}

/** Shipments a MAWB, proforma invoice no. (order number), shipment ref or Odoo invoice number belongs to. */
export async function findShipments(text: string): Promise<ShipmentRef[]> {
  const sb = getSupabase()
  const q = text.trim().replace(/[%,()]/g, ' ').trim()
  if (!q) return []
  const like = `%${q}%`
  // A MAWB is often typed without its dash (17661541003).
  const digits = q.replace(/\D/g, '')
  const mawbLike = digits.length >= 6 ? `%${digits.slice(0, 3)}%${digits.slice(3)}%` : like
  const [byShipment, byOrder, byInvoice] = await Promise.all([
    sb.from('shipments').select(SHIPMENT_FIELDS).or(`mawb.ilike.${mawbLike},shipment_ref.ilike.${like},flight_no.ilike.${like}`).limit(20),
    sb.from('customer_orders').select('shipment_id').ilike('order_number', like).not('shipment_id', 'is', null).limit(20),
    sb.from('invoices').select('shipment_id').or(`odoo_name.ilike.${like},reference.ilike.${like},mawb.ilike.${mawbLike},proforma.ilike.${like}`).not('shipment_id', 'is', null).limit(20),
  ])
  for (const r of [byShipment, byOrder, byInvoice]) if (r.error) throw new Error(r.error.message)
  const found = new Map((byShipment.data as ShipmentRef[]).map((s) => [s.id, s]))
  const more = [...new Set([...(byOrder.data ?? []), ...(byInvoice.data ?? [])].map((r) => r.shipment_id as string))].filter((id) => !found.has(id))
  if (more.length) {
    const { data, error } = await sb.from('shipments').select(SHIPMENT_FIELDS).in('id', more)
    if (error) throw new Error(error.message)
    for (const s of data as ShipmentRef[]) found.set(s.id, s)
  }
  return [...found.values()].sort((a, b) => (b.flight_date ?? '').localeCompare(a.flight_date ?? ''))
}

export interface ShipmentDocuments {
  shipment: ShipmentRef
  buyers: {
    customer_id: string
    company_name: string
    orders: { id: string; order_number: string; status: string }[]
    invoices: Invoice[]
  }[]
}
export function useShipmentDocuments(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['shipment-documents', shipmentId],
    enabled: !!shipmentId,
    queryFn: async (): Promise<ShipmentDocuments | null> => {
      const sb = getSupabase()
      const [s, o, i] = await Promise.all([
        sb.from('shipments').select(SHIPMENT_FIELDS).eq('id', shipmentId!).maybeSingle(),
        sb.from('customer_orders').select('id, order_number, status, customer_id, customers(company_name)').eq('shipment_id', shipmentId!).order('order_number'),
        sb.from('invoices').select('*, customers(company_name, customer_code)').eq('shipment_id', shipmentId!).order('created_at'),
      ])
      for (const r of [s, o, i]) if (r.error) throw new Error(r.error.message)
      if (!s.data) return null
      const buyers = new Map<string, ShipmentDocuments['buyers'][number]>()
      const buyer = (id: string, name: string) => {
        if (!buyers.has(id)) buyers.set(id, { customer_id: id, company_name: name, orders: [], invoices: [] })
        return buyers.get(id)!
      }
      for (const r of (o.data ?? []) as { id: string; order_number: string; status: string; customer_id: string; customers: { company_name: string } | { company_name: string }[] | null }[]) {
        const c = Array.isArray(r.customers) ? r.customers[0] : r.customers
        buyer(r.customer_id, c?.company_name ?? '').orders.push({ id: r.id, order_number: r.order_number, status: r.status })
      }
      for (const r of (i.data ?? []) as Invoice[]) {
        buyer(r.customer_id, r.customers?.company_name ?? '').invoices.push({ ...r, amount: Number(r.amount), odoo_amount_due: r.odoo_amount_due == null ? null : Number(r.odoo_amount_due) })
      }
      return { shipment: s.data as ShipmentRef, buyers: [...buyers.values()].sort((a, b) => a.company_name.localeCompare(b.company_name)) }
    },
  })
}
