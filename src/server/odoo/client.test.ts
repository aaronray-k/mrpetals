import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAPPED_FIELDS, odooClient, type InvoicePayload } from './client'

type Call = { service: string; method: string; args: unknown[] }

/** A fake Odoo answering JSON-RPC calls; records every call. */
function fakeOdoo(opts: { existingMove?: number; currencyActive?: boolean; canInvoice?: boolean; state?: string; lines?: number[] } = {}) {
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
    else if (model === 'account.move' && ['action_post', 'button_draft', 'write'].includes(method)) result = true
    else if (model === 'account.move' && method === 'fields_get')
      result = {
        x_studio_mawb: { string: 'MAWB', type: 'char' },
        x_studio_hawb: { string: 'HAWB', type: 'char' },
        x_studio_proforma: { string: 'Proforma Invoice No', type: 'char' },
        x_studio_flight_date: { string: 'Flight Date', type: 'date' },
        x_studio_flight_no: { string: 'Flight No.', type: 'char' },
        name: { string: 'Number', type: 'char', readonly: true },
        amount_total: { string: 'Total', type: 'monetary', readonly: true },
      }
    else if (model === 'account.move' && method === 'read')
      result = [{ name: opts.state === 'draft' ? '/' : 'INV/2026/00007', state: opts.state ?? 'posted', payment_state: 'not_paid', amount_residual: (args as number[][])[0]![0] === 900 ? 176 : 10, invoice_date_due: '2026-11-09',
        amount_untaxed: 176, amount_tax: 0, amount_total: 176, invoice_date: false, partner_id: [55, 'Pacific Floral Japan GK'], company_id: [1, 'ConsolFlora Ltd'], currency_id: [1, 'USD'],
        ref: payload.reference, invoice_payment_term_id: [4, '30 Days'], x_studio_mawb: '706-12345675' }]
    else if (model === 'account.move.line' && method === 'search') result = opts.lines ?? [31]
    else if (model === 'account.move.line' && method === 'search_read') result = [{ name: 'Cut Flowers', quantity: 1, price_unit: 176, price_subtotal: 176 }]
    else if (model === 'ir.attachment' && method === 'search') result = []
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
  it('creates the customer and a draft with one "Cut Flowers" line with the total', async () => {
    const calls = fakeOdoo({ state: 'draft' })
    const move = await client().push(payload)
    expect(move).toMatchObject({ move_id: 900, name: '/', state: 'draft', payment_state: 'not_paid', amount_due: 176, partner_id: 55 })
    expect(move.url).toBe('https://consolflora.odoo.com/web#id=900&model=account.move&view_type=form')
    const create = calls.find((c) => c.args[3] === 'account.move' && c.args[4] === 'create')!
    const values = (create.args[5] as Record<string, unknown>[])[0]!
    expect(values).toMatchObject({ move_type: 'out_invoice', partner_id: 55, currency_id: 1, ref: payload.reference })
    // Odoo dates it when it is confirmed.
    expect(values).not.toHaveProperty('invoice_date')
    expect(values.invoice_line_ids).toEqual([[0, 0, { name: 'Cut Flowers', quantity: 1, price_unit: 176 }]])
    expect(calls.some((c) => c.args[4] === 'action_post')).toBe(false)
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

  const mapped: InvoicePayload = {
    ...payload,
    mawb: '706-12345675',
    flight: 'KQ 1406',
    proforma: 'CFLPFJ0001, CFLPFJ0003',
    field_map: { mawb: 'x_studio_mawb', proforma: 'x_studio_proforma', flight: 'x_studio_flight_no' },
    payment_term_id: 4,
  }

  it('fills the MAWB, proforma numbers, flight and payment terms into the chosen Odoo fields', async () => {
    const calls = fakeOdoo({ state: 'draft' })
    await client().push(mapped)
    const values = (calls.find((c) => c.args[3] === 'account.move' && c.args[4] === 'create')!.args[5] as Record<string, unknown>[])[0]!
    expect(values).toMatchObject({ x_studio_mawb: '706-12345675', x_studio_proforma: 'CFLPFJ0001, CFLPFJ0003', x_studio_flight_no: 'KQ 1406', invoice_payment_term_id: 4 })
  })

  it('lists Odoo text fields, its own first, and suggests which is which', async () => {
    fakeOdoo()
    const fields = await client().fields()
    expect(fields.map((f) => f.name)).toEqual(['x_studio_flight_no', 'x_studio_hawb', 'x_studio_mawb', 'x_studio_proforma'])
    const guess = Object.fromEntries(MAPPED_FIELDS.map((m) => [m.key, fields.find((f) => m.guess.test(f.label))?.name]))
    expect(guess).toEqual({ mawb: 'x_studio_mawb', proforma: 'x_studio_proforma', flight: 'x_studio_flight_no' })
  })

  it('confirms a draft and resets a confirmed invoice to draft', async () => {
    let calls = fakeOdoo({ state: 'draft' })
    await client().confirm({ ...payload, odoo_move_id: 900 })
    expect(calls.filter((c) => c.args[4] === 'action_post').map((c) => c.args[5])).toEqual([[[900]]])
    calls = fakeOdoo({ state: 'posted' })
    await client().resetToDraft({ ...payload, odoo_move_id: 900 })
    expect(calls.filter((c) => c.args[4] === 'button_draft').map((c) => c.args[5])).toEqual([[[900]]])
    // Already confirmed: not confirmed twice.
    calls = fakeOdoo({ state: 'posted' })
    await client().confirm({ ...payload, odoo_move_id: 900 })
    expect(calls.some((c) => c.args[4] === 'action_post')).toBe(false)
  })

  it('fills a draft in again, but never a confirmed invoice', async () => {
    let calls = fakeOdoo({ state: 'draft' })
    await client().updateDraft({ ...mapped, odoo_move_id: 900, amount: 180 })
    const write = calls.find((c) => c.args[4] === 'write')!.args[5] as [number[], Record<string, unknown>]
    expect(write[1]).toMatchObject({ ref: payload.reference, invoice_line_ids: [[1, 31, { name: 'Cut Flowers', quantity: 1, price_unit: 180 }]], x_studio_mawb: '706-12345675' })
    calls = fakeOdoo({ state: 'posted' })
    await expect(client().updateDraft({ ...mapped, odoo_move_id: 900 })).rejects.toThrow('Only a draft can be changed')
    expect(calls.some((c) => c.args[4] === 'write')).toBe(false)
  })

  it('reads the invoice as Odoo has it, for the preview', async () => {
    fakeOdoo({ state: 'posted' })
    const d = await client().detail({ ...mapped, odoo_move_id: 900, field_map: { mawb: 'x_studio_mawb' } })
    expect(d).toMatchObject({ name: 'INV/2026/00007', partner: 'Pacific Floral Japan GK', payment_term: '30 Days', due_date: '2026-11-09', amount_total: 176, has_pdf: false })
    expect(d.lines).toEqual([{ name: 'Cut Flowers', quantity: 1, price_unit: 176, subtotal: 176 }])
    expect(d.fields).toEqual([{ key: 'mawb', field: 'x_studio_mawb', value: '706-12345675' }])
  })
})
