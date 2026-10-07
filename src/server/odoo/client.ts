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
}

/** The values ConsolFlora fills into Odoo's fields: the mapped text fields and the payment terms. */
export function filledFields(p: InvoicePayload): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  for (const f of MAPPED_FIELDS) {
    const field = p.field_map?.[f.key]
    if (field) v[field] = p[f.key] || false
  }
  if (p.payment_term_id) v.invoice_payment_term_id = p.payment_term_id
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
      const inactive: string[] = []
      for (const c of currencies) {
        const r = (await kw('res.currency', 'search_read', [[['name', '=', c]]], { fields: ['active'], context: { active_test: false }, limit: 1 })) as { active: boolean }[]
        if (!r[0]?.active) inactive.push(c)
      }
      if (inactive.length) throw new Error(`Connected, but ${inactive.join(' and ')} ${inactive.length === 1 ? 'is' : 'are'} not active in Odoo. Activate under Accounting → Configuration → Currencies.`)
      return `Connected to Odoo ${v.server_version ?? ''} as ${cfg.login}: invoices can be created${currencies.length ? `, and ${currencies.join(', ')} ${currencies.length === 1 ? 'is' : 'are'} active` : ''}.`
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
          invoice_line_ids: [[0, 0, { name: lineLabel(p), quantity: 1, price_unit: p.amount }]],
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
      const id = moveOf(p)
      const mapped = MAPPED_FIELDS.filter((f) => p.field_map?.[f.key])
      const r = (await kw('account.move', 'read', [[id]], {
        fields: ['name', 'state', 'payment_state', 'amount_residual', 'amount_untaxed', 'amount_tax', 'amount_total', 'invoice_date', 'invoice_date_due',
          'partner_id', 'company_id', 'currency_id', 'ref', 'invoice_payment_term_id', ...mapped.map((f) => p.field_map![f.key]!)],
      })) as Record<string, unknown>[]
      const m = r[0]
      if (!m) throw new Error(`Odoo invoice ${id} no longer exists.`)
      const lines = (await kw('account.move.line', 'search_read', [[['move_id', '=', id], ['display_type', '=', 'product']]], {
        fields: ['name', 'quantity', 'price_unit', 'price_subtotal'],
      })) as { name: string | false; quantity: number; price_unit: number; price_subtotal: number }[]
      const pdfs = (await kw('ir.attachment', 'search', [[['res_model', '=', 'account.move'], ['res_id', '=', id], ['mimetype', '=', 'application/pdf']]], { limit: 1 })) as number[]
      return {
        move_id: id, name: String(m.name), state: String(m.state), payment_state: String(m.payment_state), amount_due: Number(m.amount_residual), url: link(id),
        due_date: str(m.invoice_date_due), invoice_date: str(m.invoice_date), partner: many2one(m.partner_id), company: many2one(m.company_id), currency: many2one(m.currency_id),
        reference: str(m.ref), payment_term: many2one(m.invoice_payment_term_id),
        amount_untaxed: Number(m.amount_untaxed), amount_tax: Number(m.amount_tax), amount_total: Number(m.amount_total),
        lines: lines.map((l) => ({ name: l.name || '', quantity: l.quantity, price_unit: l.price_unit, subtotal: l.price_subtotal })),
        fields: mapped.map((f) => ({ key: f.key, field: p.field_map![f.key]!, value: str(m[p.field_map![f.key]!]) })),
        has_pdf: !!pdfs[0],
      }
    },
    async pdf(p) {
      const r = (await kw('ir.attachment', 'search_read', [[['res_model', '=', 'account.move'], ['res_id', '=', moveOf(p)], ['mimetype', '=', 'application/pdf']]], {
        fields: ['name', 'datas'], order: 'id desc', limit: 1,
      })) as { name: string; datas: string }[]
      return r[0] ? { name: r[0].name, base64: r[0].datas } : null
    },
    async confirm(p) {
      const id = moveOf(p)
      if ((await state(id)) !== 'posted') await kw('account.move', 'action_post', [[id]])
      return read(id)
    },
    async resetToDraft(p) {
      const id = moveOf(p)
      if ((await state(id)) !== 'draft') await kw('account.move', 'button_draft', [[id]])
      return read(id)
    },
    async updateDraft(p) {
      const id = moveOf(p)
      if ((await state(id)) !== 'draft') throw new Error('Only a draft can be changed. Reset it to draft first.')
      const lines = (await kw('account.move.line', 'search', [[['move_id', '=', id], ['display_type', '=', 'product']]])) as number[]
      const line = lines.length === 1 ? [[1, lines[0], { name: lineLabel(p), quantity: 1, price_unit: p.amount }]] : [...lines.map((l) => [2, l]), [0, 0, { name: lineLabel(p), quantity: 1, price_unit: p.amount }]]
      await kw('account.move', 'write', [[id], { ref: p.reference, invoice_line_ids: line, ...filledFields(p) }])
      return read(id)
    },
  }
}
