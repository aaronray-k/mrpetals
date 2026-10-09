import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, requireRoles, type AuthContext } from './auth'
import { MAPPED_FIELDS, odooClient, type InvoicePayload, type LedgerResult, type MoveList, type OdooAdapter, type OdooContact, type OdooField, type OdooMoveDetail } from './odoo/client'
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
    if (!a.odoo) return { pushed: 0, failed: 0, heldBack: 0, skipped: a.reason ?? null }
    let q = context.supabase.from('invoices').select('id, created_at').in('status', ['pending', 'failed']).order('created_at')
    if (data.shipmentId) q = q.eq('shipment_id', data.shipmentId)
    if (data.invoiceIds?.length) q = q.in('id', data.invoiceIds)
    const { data: all, error } = await q
    if (error) throw new Error(error.message)
    // Nothing from before go-live goes to the real Odoo (on the preview: its demo data).
    const held = a.source === 'api' && a.sendFrom ? (all ?? []).filter((r) => r.created_at < a.sendFrom!) : []
    const rows = (all ?? []).filter((r) => !held.includes(r))
    const r = await pushRows(context, a.odoo, a.source, rows.map((x) => x.id))
    const goLive = a.sendFrom ? new Date(a.sendFrom).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }) : ''
    return {
      ...r,
      heldBack: held.length,
      skipped: held.length && !rows.length
        ? `Made before Odoo go-live (${goLive}), so not sent to your real Odoo: this keeps demo and old invoices out of your books. Invoices made from now on (shipments closed, or New invoice) go to Odoo.`
        : null,
    }
  })

/** Sends invoices to Odoo one by one and records each result; failures are recorded, not thrown. */
/**
 * The real Odoo's "Cut Flowers" product for invoice lines (eTIMS needs a product on each line): found or made
 * once, then kept. Never for the demo Odoo, whose ids mean nothing in the real one. A failure leaves lines without
 * a product, as before.
 */
async function ensureLineProduct(ctx: AuthContext, odoo: OdooAdapter, source: OdooSource) {
  if (source !== 'api') return
  const { data } = await ctx.supabase.from('odoo_settings').select('line_product_id, line_label').maybeSingle()
  if (data?.line_product_id) return
  try {
    const p = await odoo.lineProduct((data?.line_label as string | undefined) || 'Cut Flowers')
    await ctx.supabase.rpc('set_odoo_line_product', { p_id: p.id, p_name: p.name })
  } catch {
    // lines go without a product; Odoo settings shows that none is set
  }
}

async function pushRows(ctx: AuthContext, odoo: OdooAdapter, source: OdooSource, ids: string[]) {
  if (ids.length) await ensureLineProduct(ctx, odoo, source)
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
    const { a, odoo, reason } = await inOdoo(context, data.id)
    if (!odoo) throw new Error(reason ?? 'Odoo is not connected.')
    // Filling a draft in again also gives its lines the product (for drafts made before there was one).
    if (data.action === 'update') await ensureLineProduct(context, odoo, a.source)
    const p = await payload(context, data.id)
    try {
      const move = data.action === 'confirm' ? await odoo.confirm(p) : data.action === 'reset' ? await odoo.resetToDraft(p) : await odoo.updateDraft(p)
      const { error } = await context.supabase.rpc('record_odoo_action', { p_invoice_id: data.id, p_action: data.action, p_ok: true, p_result: move })
      if (error) throw new Error(error.message)
      return { ok: true as const, move, pdf: data.action === 'confirm' ? await tryPdf(odoo, move.move_id) : null }
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
/** Buyer statements: an invoice with no MAWB in Odoo gets the one ConsolFlora has (the invoice's own, else its shipment's). */
async function fillMawbFromConsolFlora(ctx: AuthContext, ledger: LedgerResult) {
  const missing = [...new Set(ledger.lines.filter((l) => !l.mawb && (l.kind === 'invoice' || l.kind === 'credit_note')).map((l) => l.move_id))]
  if (!missing.length) return
  const { data } = await ctx.supabase.from('invoices').select('odoo_move_id, mawb, shipments(mawb)').in('odoo_move_id', missing)
  const known = new Map(
    ((data ?? []) as unknown as { odoo_move_id: number; mawb: string | null; shipments: { mawb: string | null } | null }[]).map((i) => [i.odoo_move_id, i.mawb || i.shipments?.mawb || null]),
  )
  for (const l of ledger.lines) if (!l.mawb && known.get(l.move_id)) l.mawb = known.get(l.move_id)
}

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
      const { data: st } = await context.supabase.from('odoo_settings').select('field_map').maybeSingle()
      const mawbField = data.side === 'buyer' ? ((st?.field_map as InvoicePayload['field_map'])?.mawb ?? null) : null
      const ledger = await a.odoo.ledger({ ...data, partner: data.partner || null, mawbField })
      if (data.side === 'buyer') await fillMawbFromConsolFlora(context, ledger)
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
      return { ok: true as const, move, pdf: data.action === 'confirm' ? await tryPdf(a.odoo, data.id) : null }
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

/** After confirming: have Odoo make its PDF. A failure doesn't undo the confirmation; it is reported instead. */
async function tryPdf(odoo: OdooAdapter, moveId: number): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await odoo.makePdf(moveId)
    return { ok: true, message: r.message }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** "Make Odoo's PDF" on a confirmed invoice: ConsolFlora's (by its id) or any Odoo document (by Odoo id). */
export const makeOdooPdf = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ invoiceId: z.string().uuid().optional(), moveId: z.number().int().positive().optional() }).refine((v) => !!v.invoiceId !== !!v.moveId))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    let odoo: OdooAdapter
    let moveId: number
    if (data.invoiceId) {
      const r = await inOdoo(context, data.invoiceId)
      if (!r.odoo) return { ok: false, message: r.reason ?? 'Odoo is not connected.' }
      odoo = r.odoo
      moveId = (await payload(context, data.invoiceId)).odoo_move_id!
    } else {
      const a = await adapter(context, { forTest: true })
      if (!a.odoo) return { ok: false, message: a.reason ?? 'Odoo is not connected.' }
      odoo = a.odoo
      moveId = data.moveId!
    }
    return tryPdf(odoo, moveId)
  })

/** For emailing an invoice: the Odoo it went to, and its Odoo id. */
export async function invoiceOdoo(ctx: AuthContext, invoiceId: string): Promise<{ odoo: OdooAdapter | null; moveId: number | null; reason: string | null }> {
  const { odoo, reason } = await inOdoo(ctx, invoiceId)
  if (!odoo) return { odoo: null, moveId: null, reason }
  return { odoo, moveId: (await payload(ctx, invoiceId)).odoo_move_id, reason: null }
}

/** The Odoo to read from (also while sending invoices is off), or null with the reason. */
export async function readOdoo(ctx: AuthContext): Promise<{ odoo: OdooAdapter | null; source: OdooSource; reason: string | null }> {
  const a = await adapter(ctx, { forTest: true })
  return { odoo: a.odoo, source: a.source === 'none' && a.odoo ? 'api' : a.source, reason: a.reason ?? null }
}

/** Contacts in Odoo (Admin, Consolidator, Finance): companies and their people, with emails. Read live. */
export const listOdooContacts = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ kind: z.enum(['all', 'buyers', 'growers']), search: z.string().trim().max(100).nullable(), offset: z.number().int().min(0) }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const r = await readOdoo(context)
    if (!r.odoo) return { source: r.source, error: r.reason ?? 'Odoo is not connected.', total: 0, contacts: [] as OdooContact[] }
    try {
      const list = await r.odoo.contacts({ ...data, search: data.search || null, limit: 50 })
      return { source: r.source, error: null, ...list }
    } catch (e) {
      return { source: r.source, error: (e as Error).message, total: 0, contacts: [] as OdooContact[] }
    }
  })

/** Odoo settings: find or make the "Cut Flowers" product in the real Odoo now (Admin). */
export const setUpOdooLineProduct = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, ['admin'])
    const r = await readOdoo(context)
    if (!r.odoo) return { ok: false, message: r.reason ?? 'Odoo is not connected.' }
    if (r.source !== 'api') return { ok: false, message: 'Only with the real Odoo: the demo Odoo has no products.' }
    try {
      const { data } = await context.supabase.from('odoo_settings').select('line_label').maybeSingle()
      const p = await r.odoo.lineProduct((data?.line_label as string | undefined) || 'Cut Flowers')
      const { error } = await context.supabase.rpc('set_odoo_line_product', { p_id: p.id, p_name: p.name })
      if (error) throw new Error(error.message)
      return { ok: true, message: p.created ? `Made "${p.name}" in Odoo. Add its KRA eTIMS item code and taxes there.` : `Using "${p.name}" from Odoo.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

/** Odoo's payment terms, to choose a buyer's on Customers (Admin, Consolidator, Finance). */
export const listOdooPaymentTerms = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, [...ROLES])
    const r = await readOdoo(context)
    if (!r.odoo) return { error: r.reason ?? 'Odoo is not connected.', terms: [] as { id: number; name: string }[] }
    try {
      return { error: null, terms: await r.odoo.paymentTerms() }
    } catch (e) {
      return { error: (e as Error).message, terms: [] as { id: number; name: string }[] }
    }
  })

/**
 * Customers ← Odoo (Admin, Consolidator): every buyer company in Odoo is linked to, or added as, a ConsolFlora
 * buyer. Read only in Odoo. Odoo ids are kept only from the real Odoo, never the preview's demo one.
 */
export const importOdooCustomers = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, ['admin', 'consolidator'])
    const r = await readOdoo(context)
    if (!r.odoo) return { error: r.reason ?? 'Odoo is not connected.', created: 0, updated: 0, found: 0 }
    try {
      const rows = await r.odoo.customers()
      const { data, error } = await context.supabase.rpc('import_odoo_customers', { p_rows: rows, p_keep_ids: r.source !== 'demo' })
      if (error) throw new Error(error.message)
      const n = data as { created: number; updated: number }
      return { error: null, created: n.created, updated: n.updated, found: rows.length }
    } catch (e) {
      return { error: (e as Error).message, created: 0, updated: 0, found: 0 }
    }
  })
