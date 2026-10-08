import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, requireRoles, type AuthContext } from './auth'
import { MAPPED_FIELDS, odooClient, type InvoicePayload, type LedgerResult, type MoveList, type OdooAdapter, type OdooField, type OdooMoveDetail } from './odoo/client'
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
    return { ...(await pushRows(context, a.odoo, a.source, (rows ?? []).map((r) => r.id))), skipped: null }
  })

/** Sends invoices to Odoo one by one and records each result; failures are recorded, not thrown. */
async function pushRows(ctx: AuthContext, odoo: OdooAdapter, source: OdooSource, ids: string[]) {
  let pushed = 0
  let failed = 0
  let lastError: string | null = null
  for (const id of ids) {
    try {
      const move = await odoo.push(await payload(ctx, id))
      const { error: e } = await ctx.supabase.rpc('record_odoo_push', { p_invoice_id: id, p_ok: true, p_result: { ...move, source } })
      if (e) throw new Error(e.message)
      pushed++
    } catch (e) {
      failed++
      lastError = (e as Error).message
      await ctx.supabase.rpc('record_odoo_push', { p_invoice_id: id, p_ok: false, p_result: {}, p_error: lastError })
    }
  }
  return { pushed, failed, lastError }
}

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

// ---------------------------------------------------------------------------------------------------------
// All invoices in Odoo (Admin, Consolidator, Finance): everything sent to buyers or received from growers,
// including documents made in Odoo itself. Reading and confirming work while sending invoices is off.
// ---------------------------------------------------------------------------------------------------------
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Odoo documents ConsolFlora made itself, by Odoo id, so they open on ConsolFlora's invoice page. */
async function ourInvoices(ctx: AuthContext, source: OdooSource, moveIds: number[]) {
  if (!moveIds.length) return new Map<number, string>()
  const { data } = await ctx.supabase.from('invoices').select('id, odoo_move_id, odoo_source').in('odoo_move_id', moveIds).eq('status', 'pushed')
  const real = source !== 'demo'
  return new Map((data ?? []).filter((i) => (i.odoo_source === 'demo') !== real).map((i) => [i.odoo_move_id as number, i.id as string]))
}

export const listOdooMoves = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      side: z.enum(['out', 'in']),
      partner: z.string().trim().max(100).nullable(),
      from: date.nullable(),
      to: date.nullable(),
      search: z.string().trim().max(100).nullable(),
      state: z.enum(['all', 'draft', 'posted', 'cancel']),
      payment: z.enum(['all', 'unpaid', 'paid']),
      offset: z.number().int().min(0),
    }),
  )
  .handler(async ({ data, context }): Promise<{ source: OdooSource; error: string | null; list: (MoveList & { ours: Record<number, string> }) | null }> => {
    requireRoles(context, [...ROLES])
    const a = await adapter(context, { forTest: true })
    if (!a.odoo) return { source: a.source, error: a.reason ?? 'Odoo is not connected.', list: null }
    const source: OdooSource = a.source === 'none' ? 'api' : a.source
    try {
      const list = await a.odoo.moves({ ...data, partner: data.partner || null, search: data.search || null, limit: 50 })
      const ours = await ourInvoices(context, source, list.moves.map((m) => m.move_id))
      return { source, error: null, list: { ...list, ours: Object.fromEntries(ours) } }
    } catch (e) {
      return { source, error: (e as Error).message, list: null }
    }
  })

export const getOdooMove = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }): Promise<{ source: OdooSource; error: string | null; detail: OdooMoveDetail | null; invoiceId: string | null }> => {
    requireRoles(context, [...ROLES])
    const a = await adapter(context, { forTest: true })
    if (!a.odoo) return { source: a.source, error: a.reason ?? 'Odoo is not connected.', detail: null, invoiceId: null }
    const source: OdooSource = a.source === 'none' ? 'api' : a.source
    try {
      const { data: st } = await context.supabase.from('odoo_settings').select('field_map').maybeSingle()
      const detail = await a.odoo.moveDetail(data.id, (st?.field_map ?? {}) as InvoicePayload['field_map'])
      const invoiceId = (await ourInvoices(context, source, [data.id])).get(data.id) ?? null
      return { source, error: null, detail, invoiceId }
    } catch (e) {
      return { source, error: (e as Error).message, detail: null, invoiceId: null }
    }
  })

export const getOdooMovePdf = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const a = await adapter(context, { forTest: true })
    return a.odoo ? a.odoo.movePdf(data.id) : null
  })

/** Confirm or reset to draft any Odoo invoice or bill. One ConsolFlora made goes through its own record, so the buyer is told. */
export const odooMoveAction = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number().int().positive(), action: z.enum(['confirm', 'reset']) }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const a = await adapter(context, { forTest: true })
    if (!a.odoo) throw new Error(a.reason ?? 'Odoo is not connected.')
    const invoiceId = (await ourInvoices(context, a.source === 'none' ? 'api' : a.source, [data.id])).get(data.id)
    try {
      const move = await a.odoo.moveAction(data.id, data.action)
      if (invoiceId) await context.supabase.rpc('record_odoo_action', { p_invoice_id: invoiceId, p_action: data.action, p_ok: true, p_result: move })
      else await context.supabase.rpc('record_odoo_move_action', { p_move_id: data.id, p_action: data.action, p_ok: true, p_message: move.name })
      return { ok: true as const, move }
    } catch (e) {
      const message = (e as Error).message
      if (invoiceId) await context.supabase.rpc('record_odoo_action', { p_invoice_id: invoiceId, p_action: data.action, p_ok: false, p_result: {}, p_error: message })
      else await context.supabase.rpc('record_odoo_move_action', { p_move_id: data.id, p_action: data.action, p_ok: false, p_message: message })
      return { ok: false as const, message }
    }
  })

/** A manual invoice or credit note: saved in ConsolFlora, then sent to Odoo as a draft (if sending is on). */
export const createManualInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      customerId: z.string().uuid(),
      kind: z.enum(['invoice', 'credit_note']),
      currency: z.string().length(3),
      reference: z.string().trim().min(1).max(200),
      lines: z.array(z.object({ name: z.string().trim().min(1).max(500), quantity: z.number().positive(), price_unit: z.number().min(0) })).min(1).max(50),
      mawb: z.string().trim().max(40).nullable(),
      proforma: z.string().trim().max(500).nullable(),
      flight: z.string().trim().max(40).nullable(),
      dueDate: date.nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const { data: id, error } = await context.supabase.rpc('create_manual_invoice', {
      p_customer_id: data.customerId, p_kind: data.kind, p_currency: data.currency, p_reference: data.reference, p_lines: data.lines,
      p_mawb: data.mawb, p_proforma: data.proforma, p_flight: data.flight, p_due_date: data.dueDate,
    })
    if (error) throw new Error(error.message)
    const invoiceId = id as string
    const a = await adapter(context)
    if (!a.odoo) return { invoiceId, pushed: false, message: `Saved, not sent to Odoo yet: ${a.reason}` }
    const r = await pushRows(context, a.odoo, a.source, [invoiceId])
    return { invoiceId, pushed: r.pushed === 1, message: r.pushed ? null : `Saved, but Odoo didn't take it: ${r.lastError}` }
  })
