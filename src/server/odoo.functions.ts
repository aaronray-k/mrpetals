import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, requireRoles, type AuthContext } from './auth'
import { MAPPED_FIELDS, odooClient, type InvoicePayload, type LedgerResult, type OdooAdapter, type OdooField } from './odoo/client'
import { demoOdoo } from './odoo/demo'

/**
 * Invoices are made in Odoo. The app server pushes them (one "Cut Flowers" line with the total) and fetches
 * back the Odoo number, status and payments. The database checks the caller may do this and records results.
 *
 * - ODOO_SOURCE=demo: the preview's stand-in Odoo.
 * - Otherwise the Odoo address, database and login from Odoo settings, and ODOO_API_KEY in the server environment.
 */
export type OdooSource = 'demo' | 'api' | 'none'
const ROLES = ['admin', 'consolidator', 'finance'] as const

async function adapter(ctx: AuthContext, opts: { forTest?: boolean } = {}): Promise<{ source: OdooSource; odoo: OdooAdapter | null; reason?: string; sendFrom?: string | null }> {
  if (process.env.ODOO_SOURCE === 'demo') {
    return {
      source: 'demo',
      odoo: demoOdoo(async (kind) => {
        const { count } = await ctx.supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('kind', kind).not('posted_at', 'is', null)
        return (count ?? 0) + 1
      }),
    }
  }
  const { data } = await ctx.supabase.from('odoo_settings').select('url, database, login, enabled, send_from').maybeSingle()
  const key = process.env.ODOO_API_KEY
  if (!key) return { source: 'none', odoo: null, reason: 'Add ODOO_API_KEY to the server environment.' }
  if (!data?.url || !data.database || !data.login) return { source: 'none', odoo: null, reason: 'Fill in the Odoo address, database and login in Odoo settings.' }
  const client = odooClient({ url: data.url, database: data.database, login: data.login, apiKey: key })
  // Test connection works while sending is still off, so the setup can be checked before anything reaches the books.
  if (!data.enabled) return { source: 'none', odoo: opts.forTest ? client : null, reason: 'Sending invoices to Odoo is switched off in Odoo settings.' }
  return { source: 'api', odoo: client, sendFrom: data.send_from as string | null }
}

async function payload(ctx: AuthContext, id: string) {
  const { data, error } = await ctx.supabase.rpc('invoice_payload', { p_invoice_id: id })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('This invoice doesn\'t exist, or you may not see it.')
  return data as InvoicePayload
}

export const getOdooStatus = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, [...ROLES])
    const a = await adapter(context)
    return { source: a.source, reason: a.reason ?? null, apiKeySet: !!process.env.ODOO_API_KEY }
  })

export const testOdoo = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, ['admin'])
    const a = await adapter(context, { forTest: true })
    const { data: cur } = await context.supabase.from('customers').select('currency').eq('active', true)
    const currencies = [...new Set((cur ?? []).map((c: { currency: string }) => c.currency))].sort()
    let ok = false
    let message = a.reason ?? ''
    if (a.odoo) {
      try {
        message = await a.odoo.test(currencies)
        ok = true
      } catch (e) {
        message = (e as Error).message
      }
    }
    await context.supabase.rpc('record_odoo_test', { p_ok: ok, p_message: message })
    return { ok, message }
  })

/** Pushes invoices waiting for Odoo (all, one shipment's, or chosen ones). Failures are recorded, not thrown. */
export const pushInvoices = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ shipmentId: z.string().uuid().optional(), invoiceIds: z.array(z.string().uuid()).optional() }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const a = await adapter(context)
    if (!a.odoo) return { pushed: 0, failed: 0, skipped: a.reason }
    let q = context.supabase.from('invoices').select('id').in('status', ['pending', 'failed']).order('created_at')
    if (data.shipmentId) q = q.eq('shipment_id', data.shipmentId)
    if (data.invoiceIds?.length) q = q.in('id', data.invoiceIds)
    // Nothing from before go-live goes to the real Odoo.
    if (a.source === 'api' && a.sendFrom) q = q.gte('created_at', a.sendFrom)
    const { data: rows, error } = await q
    if (error) throw new Error(error.message)
    let pushed = 0
    let failed = 0
    for (const r of rows ?? []) {
      try {
        const move = await a.odoo.push(await payload(context, r.id))
        const { error: e } = await context.supabase.rpc('record_odoo_push', { p_invoice_id: r.id, p_ok: true, p_result: { ...move, source: a.source } })
        if (e) throw new Error(e.message)
        pushed++
      } catch (e) {
        failed++
        await context.supabase.rpc('record_odoo_push', { p_invoice_id: r.id, p_ok: false, p_result: {}, p_error: (e as Error).message })
      }
    }
    return { pushed, failed, skipped: null }
  })

/** Fetches Odoo's state for every pushed invoice that isn't settled yet. */
export const fetchInvoices = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, [...ROLES])
    const a = await adapter(context)
    if (!a.odoo) return { updated: 0, failed: 0, skipped: a.reason }
    const { data: rows, error } = await context.supabase
      .from('invoices')
      .select('id, odoo_payment_state, odoo_state')
      .eq('status', 'pushed')
      .eq('odoo_source', a.source) // never ask the real Odoo about demo invoices, or the other way round
      .or('odoo_payment_state.is.null,odoo_payment_state.not.in.(paid,reversed)')
    if (error) throw new Error(error.message)
    let updated = 0
    let failed = 0
    for (const r of rows ?? []) {
      try {
        const move = await a.odoo.fetch(await payload(context, r.id))
        const { error: e } = await context.supabase.rpc('record_odoo_fetch', { p_invoice_id: r.id, p_result: move })
        if (e) throw new Error(e.message)
        updated++
      } catch {
        failed++
      }
    }
    await context.supabase.rpc('mark_odoo_fetched')
    return { updated, failed, skipped: null }
  })

/** One invoice for the viewer: the invoice and, when it is in the Odoo ConsolFlora is connected to, Odoo's version of it. */
async function inOdoo(ctx: AuthContext, id: string) {
  const a = await adapter(ctx)
  const { data: inv, error } = await ctx.supabase.from('invoices').select('status, odoo_source').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!inv) throw new Error('This invoice doesn\'t exist, or you may not see it.')
  if (!a.odoo) return { a, reason: a.reason ?? 'Odoo is not connected.' }
  if (inv.status !== 'pushed') return { a, reason: 'This invoice isn\'t in Odoo yet.' }
  if (inv.odoo_source && inv.odoo_source !== a.source) return { a, reason: 'This invoice went to the demo Odoo; the real Odoo doesn\'t have it.' }
  return { a, odoo: a.odoo, reason: null }
}

export const getInvoiceDetail = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const { odoo, reason } = await inOdoo(context, data.id)
    const p = await payload(context, data.id)
    if (!odoo) return { detail: null, reason, payload: p }
    try {
      const detail = await odoo.detail(p)
      // The viewer is also a fetch: keep ConsolFlora's copy of the state up to date.
      await context.supabase.rpc('record_odoo_fetch', { p_invoice_id: data.id, p_result: detail })
      return { detail, reason: null, payload: p }
    } catch (e) {
      return { detail: null, reason: (e as Error).message, payload: p }
    }
  })

export const getInvoicePdf = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const { odoo } = await inOdoo(context, data.id)
    if (!odoo) return null
    return odoo.pdf(await payload(context, data.id))
  })

/** Confirm, reset to draft, or write ConsolFlora's details into a draft again, in Odoo. */
export const invoiceAction = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid(), action: z.enum(['confirm', 'reset', 'update']) }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const { odoo, reason } = await inOdoo(context, data.id)
    if (!odoo) throw new Error(reason ?? 'Odoo is not connected.')
    const p = await payload(context, data.id)
    try {
      const move = data.action === 'confirm' ? await odoo.confirm(p) : data.action === 'reset' ? await odoo.resetToDraft(p) : await odoo.updateDraft(p)
      const { error } = await context.supabase.rpc('record_odoo_action', { p_invoice_id: data.id, p_action: data.action, p_ok: true, p_result: move })
      if (error) throw new Error(error.message)
      return { ok: true as const, move }
    } catch (e) {
      const message = (e as Error).message
      await context.supabase.rpc('record_odoo_action', { p_invoice_id: data.id, p_action: data.action, p_ok: false, p_result: {}, p_error: message })
      return { ok: false as const, message }
    }
  })

/** For Odoo settings: Odoo's text fields on invoices (with a guess for each ConsolFlora value) and its payment terms. */
export const getOdooMappingOptions = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, ['admin'])
    const a = await adapter(context, { forTest: true })
    const { data: cust } = await context.supabase.from('customers').select('payment_terms').eq('active', true)
    const buyerTerms = [...new Set((cust ?? []).map((c: { payment_terms: string }) => c.payment_terms))].sort()
    if (!a.odoo) return { error: a.reason ?? 'Odoo is not connected.', fields: [] as OdooField[], terms: [] as { id: number; name: string }[], guesses: {}, buyerTerms }
    try {
      const [fields, terms] = await Promise.all([a.odoo.fields(), a.odoo.paymentTerms()])
      const guesses = Object.fromEntries(MAPPED_FIELDS.map((m) => [m.key, fields.find((f) => m.guess.test(f.label) || m.guess.test(f.name))?.name ?? null]))
      return { error: null, fields, terms, guesses, buyerTerms }
    } catch (e) {
      return { error: (e as Error).message, fields: [] as OdooField[], terms: [] as { id: number; name: string }[], guesses: {}, buyerTerms }
    }
  })

/**
 * Statements of account (Admin and Finance): Odoo's ledger for suppliers (payables) or buyers (receivables),
 * read live. Works while sending invoices is off, as it only reads.
 */
export const getLedger = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      side: z.enum(['supplier', 'buyer']),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      partner: z.string().trim().max(100).nullable(),
      drafts: z.boolean(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ source: OdooSource; error: string | null; ledger: LedgerResult | null }> => {
    requireRoles(context, ['admin', 'finance'])
    const a = await adapter(context, { forTest: true })
    if (!a.odoo) return { source: a.source, error: a.reason ?? 'Odoo is not connected.', ledger: null }
    try {
      const ledger = await a.odoo.ledger({ ...data, partner: data.partner || null })
      return { source: a.source === 'none' ? 'api' : a.source, error: null, ledger }
    } catch (e) {
      return { source: a.source, error: (e as Error).message, ledger: null }
    }
  })
