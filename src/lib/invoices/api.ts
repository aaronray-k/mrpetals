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

export interface BankAccount {
  currency: string
  bank_name: string
  account_name: string
  account_number: string
  branch: string | null
  swift_code: string | null
}
export function useBankAccounts() {
  return useQuery({
    queryKey: ['bank-accounts'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('bank_accounts').select('currency, bank_name, account_name, account_number, branch, swift_code').order('currency')
      if (error) throw new Error(error.message)
      return data as BankAccount[]
    },
  })
}
export async function saveBankAccount(b: BankAccount) {
  const { error } = await getSupabase().from('bank_accounts').upsert(b, { onConflict: 'currency' })
  if (error) throw new Error(error.message.includes('row-level security') ? 'Only Admin users can change bank accounts.' : error.message)
}
export async function removeBankAccount(currency: string) {
  const { error } = await getSupabase().from('bank_accounts').delete().eq('currency', currency)
  if (error) throw new Error(error.message)
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
