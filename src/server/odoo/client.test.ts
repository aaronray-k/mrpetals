import { afterEach, describe, expect, it, vi } from 'vitest'
import { odooClient, type InvoicePayload } from './client'

type Call = { service: string; method: string; args: unknown[] }

/** A fake Odoo answering JSON-RPC calls; records every call. */
function fakeOdoo(opts: { existingMove?: number; currencyActive?: boolean; canInvoice?: boolean } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { params } = JSON.parse(init.body) as { params: Call }
    calls.push(params)
    const [, , , model, method, args] = params.args as [string, number, string, string, string, unknown[]]
    let result: unknown = null
    if (params.service === 'common' && params.method === 'authenticate') result = 2
    else if (params.service === 'common' && params.method === 'version') result = { server_version: '18.0' }
    else if (model === 'account.move' && method === 'check_access_rights') result = opts.canInvoice ?? true
    else if (model === 'res.partner' && method === 'search') result = []
    else if (model === 'res.country' && method === 'search') result = [113]
    else if (model === 'res.partner' && method === 'create') result = 55
    else if (model === 'res.currency') result = [{ id: 1, active: opts.currencyActive ?? true }]
    else if (model === 'account.move' && method === 'search') result = opts.existingMove ? [opts.existingMove] : []
    else if (model === 'account.move' && method === 'create') result = 900
    else if (model === 'account.move' && method === 'action_post') result = true
    else if (model === 'account.move' && method === 'read') result = [{ name: 'INV/2026/00007', state: 'posted', payment_state: 'not_paid', amount_residual: (args as number[][])[0]![0] === 900 ? 176 : 10 }]
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) }
  })
  return calls
}

const payload: InvoicePayload = {
  invoice_id: '6a0e1c2d-0000-4000-8000-000000000001',
  kind: 'invoice',
  currency: 'USD',
  amount: 176,
  reference: 'SHP-2026-0101 / CFLPFJ0001, CFLPFJ0003',
  date: '2026-10-10',
  line_label: 'Cut Flowers',
  odoo_move_id: null,
  pushed_at: null,
  orders_paid: false,
  partner: { odoo_partner_id: null, name: 'Pacific Floral Japan GK', code: 'PFJ', email: 'orders@pfj.example', country: 'Japan', city: 'Tokyo', street: '4-8-39 Minamimachi', vat: null },
}
const client = () => odooClient({ url: 'https://consolflora.odoo.com', database: 'consolflora', login: 'api@consolflora.com', apiKey: 'test-key' })

afterEach(() => vi.unstubAllGlobals())

describe('Odoo client', () => {
  it('creates the customer, one "Cut Flowers" line with the total, and posts the invoice', async () => {
    const calls = fakeOdoo()
    const move = await client().push(payload)
    expect(move).toMatchObject({ move_id: 900, name: 'INV/2026/00007', state: 'posted', payment_state: 'not_paid', amount_due: 176, partner_id: 55 })
    expect(move.url).toBe('https://consolflora.odoo.com/web#id=900&model=account.move&view_type=form')
    const create = calls.find((c) => c.args[3] === 'account.move' && c.args[4] === 'create')!
    const values = (create.args[5] as Record<string, unknown>[])[0]!
    expect(values).toMatchObject({ move_type: 'out_invoice', partner_id: 55, currency_id: 1, invoice_date: '2026-10-10', ref: payload.reference })
    expect(values.invoice_line_ids).toEqual([[0, 0, { name: 'Cut Flowers', quantity: 1, price_unit: 176 }]])
    expect(calls.some((c) => c.args[4] === 'action_post')).toBe(true)
    // Only the buyer's business details and the total leave ConsolFlora.
    expect(JSON.stringify(calls)).not.toMatch(/grower|margin|farm/i)
  })

  it('credit notes are refunds with one credit line', async () => {
    const calls = fakeOdoo()
    await client().push({ ...payload, kind: 'credit_note', amount: 12.5, reference: 'CN-2026-00001 / claim CLM-2026-00001', partner: { ...payload.partner, odoo_partner_id: 55 } })
    const values = (calls.find((c) => c.args[4] === 'create' && c.args[3] === 'account.move')!.args[5] as Record<string, unknown>[])[0]!
    expect(values.move_type).toBe('out_refund')
    expect(values.invoice_line_ids).toEqual([[0, 0, { name: 'Cut Flowers – credit (CLM-2026-00001)', quantity: 1, price_unit: 12.5 }]])
    expect(calls.some((c) => c.args[3] === 'res.partner' && c.args[4] === 'create')).toBe(false)
  })

  it('never creates a second invoice for the same reference', async () => {
    const calls = fakeOdoo({ existingMove: 777 })
    const move = await client().push(payload)
    expect(move.move_id).toBe(777)
    expect(calls.some((c) => c.args[3] === 'account.move' && c.args[4] === 'create')).toBe(false)
  })

  it('explains an inactive currency', async () => {
    fakeOdoo({ currencyActive: false })
    await expect(client().push({ ...payload, currency: 'EUR' })).rejects.toThrow('Currency EUR is not active in Odoo')
  })

  it('Test connection checks the login, invoicing rights and the buyer currencies', async () => {
    fakeOdoo()
    await expect(client().test(['EUR', 'USD'])).resolves.toBe('Connected to Odoo 18.0 as api@consolflora.com: invoices can be created, and EUR, USD are active.')
    fakeOdoo({ canInvoice: false })
    await expect(client().test(['USD'])).rejects.toThrow("can't create invoices")
    fakeOdoo({ currencyActive: false })
    await expect(client().test(['EUR'])).rejects.toThrow('EUR is not active in Odoo')
  })
})
