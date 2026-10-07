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
  pushed_at: string | null
  orders_paid: boolean
  partner: { odoo_partner_id: number | null; name: string; code: string; email: string | null; country: string | null; city: string | null; street: string | null; vat: string | null }
}
export interface OdooMove {
  move_id: number
  name: string
  state: string
  payment_state: string
  amount_due: number
  url: string
  partner_id?: number
}
export interface OdooAdapter {
  test(): Promise<string>
  push(p: InvoicePayload): Promise<OdooMove>
  fetch(p: InvoicePayload): Promise<OdooMove>
}

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
    const res = await fetch(`${cfg.url.replace(/\/$/, '')}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: ++id }),
    })
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
    const r = (await kw('account.move', 'read', [[moveId]], { fields: ['name', 'state', 'payment_state', 'amount_residual'] })) as { name: string; state: string; payment_state: string; amount_residual: number }[]
    if (!r[0]) throw new Error(`Odoo invoice ${moveId} no longer exists.`)
    return { move_id: moveId, name: r[0].name, state: r[0].state, payment_state: r[0].payment_state, amount_due: r[0].amount_residual, url: link(moveId), partner_id: partner }
  }

  return {
    async test() {
      const v = (await call('common', 'version', [])) as { server_version?: string }
      await login()
      return `Connected to Odoo ${v.server_version ?? ''} as ${cfg.login}.`
    },
    async push(p) {
      if (p.odoo_move_id) return read(p.odoo_move_id)
      const moveType = p.kind === 'invoice' ? 'out_invoice' : 'out_refund'
      const partner = await partnerId(p.partner)
      // Already there (an earlier push that wasn't recorded)? Then don't make a second one.
      const existing = (await kw('account.move', 'search', [[['ref', '=', p.reference], ['move_type', '=', moveType], ['partner_id', '=', partner], ['state', '!=', 'cancel']]], { limit: 1 })) as number[]
      if (existing[0]) return read(existing[0], partner)
      const label = p.kind === 'invoice' ? p.line_label : `${p.line_label} – credit (${p.reference.split(' / claim ')[1] ?? p.reference})`
      const moveId = (await kw('account.move', 'create', [
        {
          move_type: moveType,
          partner_id: partner,
          currency_id: await currencyId(p.currency),
          invoice_date: p.date,
          ref: p.reference,
          invoice_line_ids: [[0, 0, { name: label, quantity: 1, price_unit: p.amount }]],
        },
      ])) as number
      await kw('account.move', 'action_post', [[moveId]])
      return read(moveId, partner)
    },
    async fetch(p) {
      if (!p.odoo_move_id) throw new Error('Not in Odoo yet.')
      return read(p.odoo_move_id)
    },
  }
}
