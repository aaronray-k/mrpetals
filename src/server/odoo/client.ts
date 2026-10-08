/**
 * Odoo's external API (JSON-RPC at /jsonrpc, signed in with an API key). Odoo Online needs the Custom plan
 * for this. Only the app server calls it; the API key lives in the server environment (ODOO_API_KEY).
 */
export interface InvoicePayload {
  invoice_id: string
  kind: 'invoice' | 'credit_note'
  currency: string
  amount: number
  reference: string
  date: string
  line_label: string
  odoo_move_id: number | null
  odoo_state?: string | null
  odoo_name?: string | null
  pushed_at: string | null
  posted_at?: string | null
  orders_paid: boolean
  /** Filled into Odoo's own invoice fields, per field_map. */
  mawb?: string | null
  flight?: string | null
  proforma?: string | null
  field_map?: Partial<Record<MappedField, string>>
  payment_terms?: string | null
  payment_term_id?: number | null
  /** Set by ConsolFlora for terms like "15th of following month"; replaces any Odoo payment term on the invoice. */
  due_date?: string | null
  /** A manual invoice's own lines; otherwise one line with the total. */
  lines?: { name: string; quantity: number; price_unit: number }[] | null
  partner: { odoo_partner_id: number | null; name: string; code: string; email: string | null; country: string | null; city: string | null; street: string | null; vat: string | null }
}
export type MappedField = 'mawb' | 'proforma' | 'flight'
export const MAPPED_FIELDS: { key: MappedField; label: string; guess: RegExp }[] = [
  { key: 'mawb', label: 'MAWB / AWB', guess: /\bm?awb|air ?way ?bill/i },
  { key: 'proforma', label: 'Proforma invoice no.', guess: /pro-? ?forma/i },
  { key: 'flight', label: 'Flight number', guess: /flight ?(no\b|num|#|details)|^flight$/i },
]
export interface OdooField {
  name: string
  label: string
  type: string
}
/** One invoice as Odoo has it, for the live preview. */
export interface OdooMoveDetail extends OdooMove {
  /** out_invoice, out_refund, in_invoice, in_refund */
  move_type: string
  partner: string | null
  company: string | null
  currency: string | null
  reference: string | null
  invoice_date: string | null
  due_date: string | null
  payment_term: string | null
  amount_untaxed: number
  amount_tax: number
  amount_total: number
  lines: { name: string; quantity: number; price_unit: number; subtotal: number }[]
  fields: { key: MappedField; field: string; value: string | null }[]
  has_pdf: boolean
}
export interface OdooMove {
  move_id: number
  name: string
  state: string
  payment_state: string
  amount_due: number
  url: string
  due_date?: string | null
  partner_id?: number
  source?: 'demo' | 'api'
}
/** Statements of account: Odoo's ledger lines on suppliers' payable or buyers' receivable accounts. */
export type LedgerSide = 'supplier' | 'buyer'
export interface LedgerQuery {
  side: LedgerSide
  /** Lines from this date; everything before it is the balance brought forward. Null: from the start. */
  from: string | null
  to: string
  /** Part of the supplier's or buyer's name. */
  partner: string | null
  drafts: boolean
}
export interface LedgerLine {
  id: number
  date: string
  number: string
  reference: string | null
  due_date: string | null
  partner_id: number
  partner: string
  currency: string
  /** In the line's currency, signed as Odoo keeps it (a supplier bill is negative, a payment to them positive). */
  amount: number
  kind: 'bill' | 'refund' | 'invoice' | 'credit_note' | 'payment' | 'entry'
  draft: boolean
}
export interface LedgerResult {
  lines: LedgerLine[]
  /** Per supplier or buyer and currency: the sum of lines before `from`. */
  opening: { partner_id: number; partner: string; currency: string; amount: number }[]
}

/** All invoices in Odoo: sent to buyers (invoices, credit notes) or received from growers (bills, refunds). */
export type MoveSide = 'out' | 'in'
export interface MoveQuery {
  side: MoveSide
  partner: string | null
  from: string | null
  to: string | null
  /** Number or reference. */
  search: string | null
  state: 'all' | 'draft' | 'posted' | 'cancel'
  payment: 'all' | 'unpaid' | 'paid'
  offset: number
  limit: number
}
export interface OdooMoveSummary {
  move_id: number
  move_type: string
  name: string
  partner: string | null
  date: string | null
  due_date: string | null
  reference: string | null
  currency: string
  amount_total: number
  amount_due: number
  state: string
  payment_state: string
}
export interface MoveList {
  total: number
  moves: OdooMoveSummary[]
  /** What is still due on everything matching, per currency. */
  due: { currency: string; amount: number }[]
}

export interface OdooAdapter {
  /** Checks the login, API access (Odoo Online: Custom plan), invoicing rights and the currencies given. */
  test(currencies: string[]): Promise<string>
  push(p: InvoicePayload): Promise<OdooMove>
  fetch(p: InvoicePayload): Promise<OdooMove>
  /** Odoo's text fields on invoices, to choose where the MAWB, proforma and flight go. */
  fields(): Promise<OdooField[]>
  paymentTerms(): Promise<{ id: number; name: string }[]>
  detail(p: InvoicePayload): Promise<OdooMoveDetail>
  /** Odoo's PDF of the invoice, if Odoo has made one (it does when the invoice is printed or sent). */
  pdf(p: InvoicePayload): Promise<{ name: string; base64: string } | null>
  confirm(p: InvoicePayload): Promise<OdooMove>
  resetToDraft(p: InvoicePayload): Promise<OdooMove>
  /** Writes ConsolFlora's details (reference, total, fields, payment terms) into a draft again. */
  updateDraft(p: InvoicePayload): Promise<OdooMove>
  ledger(q: LedgerQuery): Promise<LedgerResult>
  moves(q: MoveQuery): Promise<MoveList>
  moveDetail(moveId: number, fieldMap?: InvoicePayload['field_map']): Promise<OdooMoveDetail>
  movePdf(moveId: number): Promise<{ name: string; base64: string } | null>
  moveAction(moveId: number, action: 'confirm' | 'reset'): Promise<OdooMove>
  /** Has Odoo make its PDF of a confirmed invoice (Odoo's Send & Print, with email off). Never emails anyone. */
  makePdf(moveId: number): Promise<{ made: boolean; message: string }>
}

/** Odoo's PDF of an invoice. Odoo 17+ keeps it as a field attachment, which a plain attachment search leaves out. */
export const pdfDomain = (id: number): unknown[] => [
  ['res_model', '=', 'account.move'],
  ['res_id', '=', id],
  ['mimetype', '=', 'application/pdf'],
  '|',
  ['res_field', '=', false],
  ['res_field', '!=', false],
]
/**
 * How each Odoo version makes an invoice PDF without sending it: its Send & Print wizard with every way of
 * sending switched off. Values are explicit: a wizard whose fields don't match is refused by Odoo, never run
 * with its defaults (which could email the buyer).
 */
export const PDF_WIZARDS: { model: string; values: Record<string, unknown>; field: string }[] = [
  { model: 'account.move.send.wizard', values: { sending_methods: [] }, field: 'sending_methods' }, // Odoo 18 and later
  { model: 'account.move.send', values: { checkbox_send_mail: false, checkbox_download: false }, field: 'checkbox_send_mail' }, // Odoo 17
]

/** The invoice lines Odoo gets: a manual invoice's own lines, otherwise one line with the total. */
export function invoiceLines(p: InvoicePayload): unknown[] {
  if (p.lines?.length) return p.lines.map((l) => [0, 0, { name: l.name, quantity: l.quantity, price_unit: l.price_unit }])
  return [[0, 0, { name: lineLabel(p), quantity: 1, price_unit: p.amount }]]
}
export const MOVE_TYPES: Record<MoveSide, string[]> = { out: ['out_invoice', 'out_refund'], in: ['in_invoice', 'in_refund'] }
export function moveDomain(q: MoveQuery): unknown[] {
  const d: unknown[] = [['move_type', 'in', MOVE_TYPES[q.side]]]
  if (q.partner) d.push(['partner_id', 'ilike', q.partner])
  if (q.from) d.push(['date', '>=', q.from])
  if (q.to) d.push(['date', '<=', q.to])
  if (q.search) d.push('|', ['name', 'ilike', q.search], ['ref', 'ilike', q.search])
  if (q.state !== 'all') d.push(['state', '=', q.state])
  if (q.payment === 'unpaid') d.push(['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']])
  if (q.payment === 'paid') d.push(['payment_state', 'in', ['paid', 'in_payment', 'reversed']])
  return d
}

const KIND: Record<string, LedgerLine['kind']> = { in_invoice: 'bill', in_refund: 'refund', out_invoice: 'invoice', out_refund: 'credit_note' }

/** The values ConsolFlora fills into Odoo's fields: the mapped text fields and the payment terms. */
export function filledFields(p: InvoicePayload): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  for (const f of MAPPED_FIELDS) {
    const field = p.field_map?.[f.key]
    if (field) v[field] = p[f.key] || false
  }
  if (p.due_date) {
    // ConsolFlora's own due date: no Odoo payment term (not even the customer's default), so Odoo keeps the date.
    v.invoice_payment_term_id = false
    v.invoice_date_due = p.due_date
  } else if (p.payment_term_id) v.invoice_payment_term_id = p.payment_term_id
  return v
}
export const lineLabel = (p: InvoicePayload) =>
  p.kind === 'invoice' ? p.line_label : `${p.line_label} – credit (${p.reference.split(' / claim ')[1] ?? p.reference})`
const many2one = (v: unknown) => (Array.isArray(v) ? String(v[1]) : null)
const str = (v: unknown) => (v === false || v == null ? null : String(v))

export interface OdooConfig {
  url: string
  database: string
  login: string
  apiKey: string
}

export function odooClient(cfg: OdooConfig): OdooAdapter {
  let uid: number | null = null
  let id = 0
  async function call(service: string, method: string, args: unknown[]) {
    let res: Response
    try {
      res = await fetch(`${cfg.url.replace(/\/$/, '')}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: ++id }),
      })
    } catch {
      throw new Error(`Couldn't reach ${cfg.url}. Check the Odoo address on Odoo settings.`)
    }
    if (!res.ok) throw new Error(`Odoo answered ${res.status} ${res.statusText}`)
    const body = (await res.json()) as { result?: unknown; error?: { message: string; data?: { message?: string } } }
    if (body.error) throw new Error(body.error.data?.message ?? body.error.message)
    return body.result
  }
  async function login() {
    if (uid != null) return uid
    const r = await call('common', 'authenticate', [cfg.database, cfg.login, cfg.apiKey, {}])
    if (!r) throw new Error('Odoo refused the login: check the database, login and API key.')
    uid = r as number
    return uid
  }
  async function kw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
    return call('object', 'execute_kw', [cfg.database, await login(), cfg.apiKey, model, method, args, kwargs])
  }
  const link = (moveId: number) => `${cfg.url.replace(/\/$/, '')}/web#id=${moveId}&model=account.move&view_type=form`

  async function partnerId(p: InvoicePayload['partner']) {
    if (p.odoo_partner_id) return p.odoo_partner_id
    const found = (await kw('res.partner', 'search', [[['ref', '=', p.code]]], { limit: 1 })) as number[]
    if (found[0]) return found[0]
    const country = p.country ? ((await kw('res.country', 'search', [[['name', '=ilike', p.country]]], { limit: 1 })) as number[])[0] : undefined
    return (await kw('res.partner', 'create', [
      { name: p.name, ref: p.code, is_company: true, customer_rank: 1, email: p.email || false, city: p.city || false, street: p.street || false, vat: p.vat || false, country_id: country ?? false },
    ])) as number
  }
  async function currencyId(code: string) {
    const r = (await kw('res.currency', 'search_read', [[['name', '=', code]]], { fields: ['id', 'active'], context: { active_test: false }, limit: 1 })) as { id: number; active: boolean }[]
    if (!r[0]) throw new Error(`Odoo has no currency ${code}.`)
    if (!r[0].active) throw new Error(`Currency ${code} is not active in Odoo. Activate it under Accounting → Configuration → Currencies.`)
    return r[0].id
  }
  async function read(moveId: number, partner?: number): Promise<OdooMove> {
    const r = (await kw('account.move', 'read', [[moveId]], { fields: ['name', 'state', 'payment_state', 'amount_residual', 'invoice_date_due'] })) as { name: string; state: string; payment_state: string; amount_residual: number; invoice_date_due: string | false }[]
    if (!r[0]) throw new Error(`Odoo invoice ${moveId} no longer exists.`)
    return { move_id: moveId, name: r[0].name, state: r[0].state, payment_state: r[0].payment_state, amount_due: r[0].amount_residual, due_date: str(r[0].invoice_date_due), url: link(moveId), partner_id: partner }
  }
  function moveOf(p: InvoicePayload) {
    if (!p.odoo_move_id) throw new Error('This invoice isn\'t in Odoo yet.')
    return p.odoo_move_id
  }
  async function state(moveId: number) {
    const r = (await kw('account.move', 'read', [[moveId]], { fields: ['state'] })) as { state: string }[]
    if (!r[0]) throw new Error(`Odoo invoice ${moveId} no longer exists.`)
    return r[0].state
  }

  return {
    async test(currencies) {
      const v = (await call('common', 'version', [])) as { server_version?: string }
      await login()
      let canInvoice = false
      try {
        canInvoice = (await kw('account.move', 'check_access_rights', ['create'], { raise_exception: false })) as boolean
      } catch (e) {
        throw new Error(`Signed in, but Odoo refused the API: ${(e as Error).message}. On Odoo Online the external API needs the Custom plan.`)
      }
      if (!canInvoice) throw new Error(`Signed in as ${cfg.login}, but this user can't create invoices. Give it Accounting rights (Invoicing: Billing or more).`)
      const canRead = (await kw('account.move.line', 'check_access_rights', ['read'], { raise_exception: false })) as boolean
      if (!canRead) throw new Error(`Signed in as ${cfg.login}, but this user can't read journal items, so statements of account won't work. Give it Accounting rights.`)
      const bills = (await kw('account.move', 'search_count', [[['move_type', '=', 'in_invoice'], ['state', '=', 'posted']]])) as number
      const inactive: string[] = []
      for (const c of currencies) {
        const r = (await kw('res.currency', 'search_read', [[['name', '=', c]]], { fields: ['active'], context: { active_test: false }, limit: 1 })) as { active: boolean }[]
        if (!r[0]?.active) inactive.push(c)
      }
      if (inactive.length) throw new Error(`Connected, but ${inactive.join(' and ')} ${inactive.length === 1 ? 'is' : 'are'} not active in Odoo. Activate under Accounting → Configuration → Currencies.`)
      // Can ConsolFlora have Odoo make invoice PDFs? (Its Send & Print wizard, with the field that switches email off.)
      let pdfs = false
      for (const w of PDF_WIZARDS) {
        try {
          const f = (await kw(w.model, 'fields_get', [[w.field]], { attributes: ['type'] })) as Record<string, unknown>
          if (f[w.field]) pdfs = true
        } catch {
          // this Odoo version doesn't have that wizard
        }
        if (pdfs) break
      }
      return `Connected to Odoo ${v.server_version ?? ''} as ${cfg.login}: invoices can be created, ${bills} confirmed vendor bills can be read${currencies.length ? `, ${currencies.join(', ')} ${currencies.length === 1 ? 'is' : 'are'} active` : ''}, and Odoo's invoice PDFs ${pdfs ? 'can be made from ConsolFlora' : "can't be made from ConsolFlora (press Print in Odoo instead)"}.`
    },
    async push(p) {
      if (p.odoo_move_id) return read(p.odoo_move_id)
      const moveType = p.kind === 'invoice' ? 'out_invoice' : 'out_refund'
      const partner = await partnerId(p.partner)
      // Already there (an earlier push that wasn't recorded)? Then don't make a second one.
      const existing = (await kw('account.move', 'search', [[['ref', '=', p.reference], ['move_type', '=', moveType], ['partner_id', '=', partner], ['state', '!=', 'cancel']]], { limit: 1 })) as number[]
      if (existing[0]) return read(existing[0], partner)
      // A draft: Admin, Consolidator or Finance confirm it (in ConsolFlora or Odoo); Odoo dates it then.
      const moveId = (await kw('account.move', 'create', [
        {
          move_type: moveType,
          partner_id: partner,
          currency_id: await currencyId(p.currency),
          ref: p.reference,
          invoice_line_ids: invoiceLines(p),
          ...filledFields(p),
        },
      ])) as number
      return read(moveId, partner)
    },
    async fetch(p) {
      return read(moveOf(p))
    },
    async fields() {
      const all = (await kw('account.move', 'fields_get', [], { attributes: ['string', 'type', 'readonly', 'store'] })) as Record<string, { string: string; type: string; readonly?: boolean; store?: boolean }>
      return Object.entries(all)
        .filter(([name, f]) => ['char', 'text'].includes(f.type) && f.store !== false && (name.startsWith('x_') || !f.readonly))
        .map(([name, f]) => ({ name, label: f.string, type: f.type }))
        .sort((a, b) => Number(b.name.startsWith('x_')) - Number(a.name.startsWith('x_')) || a.label.localeCompare(b.label))
    },
    async paymentTerms() {
      return (await kw('account.payment.term', 'search_read', [[]], { fields: ['name'], order: 'name' })) as { id: number; name: string }[]
    },
    async detail(p) {
      return this.moveDetail(moveOf(p), p.field_map)
    },
    async moveDetail(id, fieldMap) {
      const mapped = MAPPED_FIELDS.filter((f) => fieldMap?.[f.key])
      const r = (await kw('account.move', 'read', [[id]], {
        fields: ['name', 'move_type', 'state', 'payment_state', 'amount_residual', 'amount_untaxed', 'amount_tax', 'amount_total', 'invoice_date', 'invoice_date_due',
          'partner_id', 'company_id', 'currency_id', 'ref', 'invoice_payment_term_id', ...mapped.map((f) => fieldMap![f.key]!)],
      })) as Record<string, unknown>[]
      const m = r[0]
      if (!m) throw new Error(`Odoo invoice ${id} no longer exists.`)
      const lines = (await kw('account.move.line', 'search_read', [[['move_id', '=', id], ['display_type', '=', 'product']]], {
        fields: ['name', 'quantity', 'price_unit', 'price_subtotal'],
      })) as { name: string | false; quantity: number; price_unit: number; price_subtotal: number }[]
      const pdfs = (await kw('ir.attachment', 'search', [pdfDomain(id)], { limit: 1 })) as number[]
      return {
        move_id: id, move_type: String(m.move_type), name: String(m.name), state: String(m.state), payment_state: String(m.payment_state), amount_due: Number(m.amount_residual), url: link(id),
        due_date: str(m.invoice_date_due), invoice_date: str(m.invoice_date), partner: many2one(m.partner_id), company: many2one(m.company_id), currency: many2one(m.currency_id),
        reference: str(m.ref), payment_term: many2one(m.invoice_payment_term_id),
        amount_untaxed: Number(m.amount_untaxed), amount_tax: Number(m.amount_tax), amount_total: Number(m.amount_total),
        lines: lines.map((l) => ({ name: l.name || '', quantity: l.quantity, price_unit: l.price_unit, subtotal: l.price_subtotal })),
        fields: mapped.map((f) => ({ key: f.key, field: fieldMap![f.key]!, value: str(m[fieldMap![f.key]!]) })),
        has_pdf: !!pdfs[0],
      }
    },
    async moves(q) {
      const domain = moveDomain(q)
      const [total, rows, due] = await Promise.all([
        kw('account.move', 'search_count', [domain]) as Promise<number>,
        kw('account.move', 'search_read', [domain], {
          fields: ['name', 'move_type', 'partner_id', 'invoice_date', 'date', 'invoice_date_due', 'ref', 'currency_id', 'amount_total', 'amount_residual', 'state', 'payment_state'],
          order: 'date desc, id desc',
          offset: q.offset,
          limit: q.limit,
        }) as Promise<Record<string, unknown>[]>,
        kw('account.move', 'search_read', [[...domain, ['state', '=', 'posted'], ['amount_residual', '>', 0]]], { fields: ['currency_id', 'amount_residual'] }) as Promise<{ currency_id: [number, string]; amount_residual: number }[]>,
      ])
      const sums = new Map<string, number>()
      for (const d of due) sums.set(d.currency_id[1], (sums.get(d.currency_id[1]) ?? 0) + d.amount_residual)
      return {
        total,
        moves: rows.map((m) => ({
          move_id: Number(m.id), move_type: String(m.move_type), name: String(m.name), partner: many2one(m.partner_id), date: str(m.invoice_date) ?? str(m.date),
          due_date: str(m.invoice_date_due), reference: str(m.ref), currency: many2one(m.currency_id) ?? '', amount_total: Number(m.amount_total),
          amount_due: Number(m.amount_residual), state: String(m.state), payment_state: String(m.payment_state),
        })),
        due: [...sums].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })).sort((a, b) => a.currency.localeCompare(b.currency)),
      }
    },
    async movePdf(id) {
      const r = (await kw('ir.attachment', 'search_read', [pdfDomain(id)], {
        fields: ['name', 'datas'], order: 'id desc', limit: 1,
      })) as { name: string; datas: string }[]
      return r[0] ? { name: r[0].name, base64: r[0].datas } : null
    },
    async makePdf(id) {
      const has = async () => ((await kw('ir.attachment', 'search_count', [pdfDomain(id)])) as number) > 0
      if (await has()) return { made: false, message: 'Odoo already has its PDF.' }
      if ((await state(id)) !== 'posted') throw new Error('Odoo makes the PDF once the invoice is confirmed.')
      const context = { active_model: 'account.move', active_ids: [id], active_id: id }
      let last = ''
      for (const w of PDF_WIZARDS) {
        try {
          const wizard = (await kw(w.model, 'create', [w.values], { context })) as number
          await kw(w.model, 'action_send_and_print', [[wizard]], { context })
          if (await has()) return { made: true, message: "Odoo made its PDF." }
        } catch (e) {
          last = (e as Error).message
        }
      }
      throw new Error(`Odoo didn't make its PDF from ConsolFlora${last ? ` (${last})` : ''}. Press Print on the invoice in Odoo once; the PDF then shows here.`)
    },
    async moveAction(id, action) {
      const now = await state(id)
      if (action === 'confirm' && now !== 'posted') await kw('account.move', 'action_post', [[id]])
      if (action === 'reset' && now !== 'draft') await kw('account.move', 'button_draft', [[id]])
      return read(id)
    },
    async pdf(p) {
      return this.movePdf(moveOf(p))
    },
    async confirm(p) {
      return this.moveAction(moveOf(p), 'confirm')
    },
    async resetToDraft(p) {
      return this.moveAction(moveOf(p), 'reset')
    },
    async ledger(q) {
      const base: unknown[] = [
        ['account_id.account_type', '=', q.side === 'supplier' ? 'liability_payable' : 'asset_receivable'],
        ['partner_id', '!=', false],
        ['parent_state', 'in', q.drafts ? ['posted', 'draft'] : ['posted']],
      ]
      if (q.partner) base.push(['partner_id', 'ilike', q.partner])
      type Raw = { id: number; date: string; move_id: [number, string]; move_name: string | false; ref: string | false; name: string | false; date_maturity: string | false; partner_id: [number, string]; currency_id: [number, string]; amount_currency: number; parent_state: string }
      const raw = (await kw('account.move.line', 'search_read', [[...base, ['date', '<=', q.to], ...(q.from ? [['date', '>=', q.from]] : [])]], {
        fields: ['date', 'move_id', 'move_name', 'ref', 'name', 'date_maturity', 'partner_id', 'currency_id', 'amount_currency', 'parent_state'],
        order: 'date asc, move_name asc, id asc',
      })) as Raw[]
      // What each line belongs to: a bill, refund, invoice, credit note, or (bank or cash journal) a payment.
      const moveIds = [...new Set(raw.map((l) => l.move_id[0]))]
      const moves = moveIds.length ? ((await kw('account.move', 'read', [moveIds], { fields: ['move_type', 'journal_id'] })) as { id: number; move_type: string; journal_id: [number, string] | false }[]) : []
      const journalIds = [...new Set(moves.flatMap((m) => (m.journal_id ? [m.journal_id[0]] : [])))]
      const journals = journalIds.length ? ((await kw('account.journal', 'read', [journalIds], { fields: ['type'] })) as { id: number; type: string }[]) : []
      const cash = new Set(journals.filter((j) => j.type === 'bank' || j.type === 'cash').map((j) => j.id))
      const kindOf = new Map(moves.map((m) => [m.id, KIND[m.move_type] ?? (m.journal_id && cash.has(m.journal_id[0]) ? 'payment' : 'entry')] as const))
      const lines: LedgerLine[] = raw.map((l) => {
        const kind = kindOf.get(l.move_id[0]) ?? 'entry'
        return {
          id: l.id,
          date: l.date,
          number: l.move_name || l.move_id[1],
          reference: str(l.ref) ?? (kind === 'payment' || kind === 'entry' ? str(l.name) : null),
          due_date: kind === 'bill' || kind === 'invoice' ? str(l.date_maturity) : null,
          partner_id: l.partner_id[0],
          partner: l.partner_id[1],
          currency: l.currency_id[1],
          amount: l.amount_currency,
          kind,
          draft: l.parent_state === 'draft',
        }
      })
      const opening = new Map<string, LedgerResult['opening'][number]>()
      if (q.from) {
        const before = (await kw('account.move.line', 'search_read', [[...base, ['date', '<', q.from]]], { fields: ['partner_id', 'currency_id', 'amount_currency'] })) as Pick<Raw, 'partner_id' | 'currency_id' | 'amount_currency'>[]
        for (const l of before) {
          const key = `${l.partner_id[0]}|${l.currency_id[1]}`
          const o = opening.get(key) ?? { partner_id: l.partner_id[0], partner: l.partner_id[1], currency: l.currency_id[1], amount: 0 }
          o.amount += l.amount_currency
          opening.set(key, o)
        }
      }
      return { lines, opening: [...opening.values()] }
    },
    async updateDraft(p) {
      const id = moveOf(p)
      if ((await state(id)) !== 'draft') throw new Error('Only a draft can be changed. Reset it to draft first.')
      const lines = (await kw('account.move.line', 'search', [[['move_id', '=', id], ['display_type', '=', 'product']]])) as number[]
      const line = lines.length === 1 && !p.lines?.length ? [[1, lines[0], { name: lineLabel(p), quantity: 1, price_unit: p.amount }]] : [...lines.map((l) => [2, l]), ...invoiceLines(p)]
      await kw('account.move', 'write', [[id], { ref: p.reference, invoice_line_ids: line, ...filledFields(p) }])
      return read(id)
    },
  }
}
