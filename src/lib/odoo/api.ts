import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { fetchInvoices, getOdooStatus, pushInvoices, testOdoo } from '~/server/odoo.functions'

export interface Invoice {
  id: string
  kind: 'invoice' | 'credit_note'
  customer_id: string
  shipment_id: string | null
  credit_note_id: string | null
  currency: string
  amount: number
  reference: string
  order_ids: string[]
  status: 'pending' | 'pushed' | 'failed'
  attempts: number
  last_error: string | null
  odoo_name: string | null
  odoo_state: string | null
  odoo_payment_state: string | null
  odoo_amount_due: number | null
  odoo_url: string | null
  created_at: string
  pushed_at: string | null
  fetched_at: string | null
  customers: { company_name: string; customer_code: string } | null
}

export function useInvoices(filter?: { shipmentId?: string; orderId?: string }) {
  return useQuery({
    queryKey: ['invoices', filter ?? {}],
    queryFn: async () => {
      let q = getSupabase().from('invoices').select('*, customers(company_name, customer_code)').order('created_at', { ascending: false })
      if (filter?.shipmentId) q = q.eq('shipment_id', filter.shipmentId)
      if (filter?.orderId) q = q.contains('order_ids', [filter.orderId])
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data as Invoice[]).map((i) => ({ ...i, amount: Number(i.amount), odoo_amount_due: i.odoo_amount_due == null ? null : Number(i.odoo_amount_due) }))
    },
  })
}

export interface OdooSettings {
  url: string | null
  database: string | null
  login: string | null
  enabled: boolean
  line_label: string
  last_fetch_at: string | null
}
export function useOdooSettings() {
  return useQuery({
    queryKey: ['odoo-settings'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('odoo_settings').select('url, database, login, enabled, line_label, last_fetch_at').maybeSingle()
      if (error) throw new Error(error.message)
      return data as OdooSettings | null
    },
  })
}
export async function saveOdooSettings(s: Omit<OdooSettings, 'last_fetch_at'>) {
  const { data, error } = await getSupabase().from('odoo_settings').update(s).eq('id', true).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Only Admin users can change Odoo settings.')
}

export function useOdooLog() {
  return useQuery({
    queryKey: ['odoo-log'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('odoo_sync_log').select('id, at, action, ok, message, invoice_id').order('at', { ascending: false }).limit(20)
      if (error) throw new Error(error.message)
      return data as { id: number; at: string; action: string; ok: boolean; message: string | null; invoice_id: string | null }[]
    },
  })
}

export function useOdooStatus(enabled = true) {
  return useQuery({ queryKey: ['odoo-status'], enabled, queryFn: () => getOdooStatus(), staleTime: 60_000 })
}
export const pushToOdoo = (data: { shipmentId?: string; invoiceIds?: string[] } = {}) => pushInvoices({ data })
export const fetchFromOdoo = () => fetchInvoices()
export const testOdooConnection = () => testOdoo()

const PAYMENT: Record<string, string> = { not_paid: 'Not paid', in_payment: 'Payment in progress', partial: 'Partly paid', paid: 'Paid', reversed: 'Reversed' }
export const paymentLabel = (s: string | null) => (s ? (PAYMENT[s] ?? s) : '—')
