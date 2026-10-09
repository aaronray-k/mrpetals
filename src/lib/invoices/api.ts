import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { downloadProformaPdf, getInvoiceEmailDraft, sendInvoiceEmail, sendTestEmail } from '~/server/invoice-email.functions'

export function useInvoiceEmailDraft(invoiceId: string, enabled: boolean) {
  return useQuery({ queryKey: ['invoice-email-draft', invoiceId], enabled, queryFn: () => getInvoiceEmailDraft({ data: { invoiceId } }), staleTime: 0 })
}
export const sendInvoiceByEmail = (data: { invoiceId: string; to: string[]; cc: string[]; subject: string; body: string; attachInvoice: boolean; orderIds: string[] }) =>
  sendInvoiceEmail({ data })
export const proformaPdfFile = (orderId: string) => downloadProformaPdf({ data: { orderId } })
export const testEmail = () => sendTestEmail()

export interface InvoiceEmailLog {
  id: number
  sent_at: string
  to_addresses: string[]
  cc_addresses: string[]
  subject: string
  attachments: string[]
  ok: boolean
  error: string | null
  profiles: { full_name: string | null } | null
}
export function useInvoiceEmails(invoiceId: string) {
  return useQuery({
    queryKey: ['invoice-emails', invoiceId],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('invoice_emails').select('id, sent_at, to_addresses, cc_addresses, subject, attachments, ok, error, sent_by').eq('invoice_id', invoiceId).order('sent_at', { ascending: false })
      if (error) throw new Error(error.message)
      const ids = [...new Set((data ?? []).map((r) => r.sent_by).filter(Boolean))] as string[]
      const { data: people } = ids.length ? await getSupabase().from('profiles').select('id, full_name').in('id', ids) : { data: [] }
      const names = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string | null]))
      return (data ?? []).map((r) => ({ ...r, profiles: { full_name: names.get(r.sent_by as string) ?? null } })) as InvoiceEmailLog[]
    },
  })
}

/** ConsolFlora's bank details (one bank), and the account number for each currency. */
export interface BankDetails {
  account_name: string
  bank_name: string
  bank_code: string | null
  branch: string | null
  swift_code: string | null
}
export function useBank() {
  return useQuery({
    queryKey: ['bank'],
    queryFn: async () => {
      const sb = getSupabase()
      const [d, a] = await Promise.all([
        sb.from('bank_details').select('account_name, bank_name, bank_code, branch, swift_code').maybeSingle(),
        sb.from('bank_accounts').select('currency, account_number').order('currency'),
      ])
      if (d.error) throw new Error(d.error.message)
      if (a.error) throw new Error(a.error.message)
      return { details: d.data as BankDetails | null, accounts: a.data as { currency: string; account_number: string }[] }
    },
  })
}
const adminOnly = (m: string) => (m.includes('row-level security') ? 'Only Admin users can change the bank details.' : m)
/** Saves the shared details and the account numbers; an empty number removes that currency's account. */
export async function saveBank(details: BankDetails, numbers: Record<string, string>) {
  const sb = getSupabase()
  const d = await sb.from('bank_details').upsert({ id: true, ...details }, { onConflict: 'id' })
  if (d.error) throw new Error(adminOnly(d.error.message))
  const keep = Object.entries(numbers).filter(([, n]) => n.trim())
  if (keep.length) {
    const a = await sb.from('bank_accounts').upsert(keep.map(([currency, n]) => ({ currency, account_number: n.trim() })), { onConflict: 'currency' })
    if (a.error) throw new Error(adminOnly(a.error.message))
  }
  const drop = Object.entries(numbers).filter(([, n]) => !n.trim()).map(([c]) => c)
  if (drop.length) {
    const r = await sb.from('bank_accounts').delete().in('currency', drop)
    if (r.error) throw new Error(adminOnly(r.error.message))
  }
}

/** Opens a base64 PDF from the server as a download. */
export function downloadBase64Pdf(name: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
