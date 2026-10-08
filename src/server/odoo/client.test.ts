import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAPPED_FIELDS, contactDomain, defaultRecipients, moveDomain, odooClient, pdfDomain, type InvoicePayload, type OdooContact } from './client'

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
    else if (model === 'account.move.line' && method === 'check_access_rights') result = true
    else if (model === 'account.move' && method === 'search_count') result = 42
    else if (model === 'account.move.line' && method === 'search_read' && (args as unknown[][])[0]!.some((d) => Array.isArray(d) && d[0] === 'account_id.account_type'))
      result = (args as unknown[][])[0]!.some((d) => Array.isArray(d) && d[1] === '<')
        ? [{ partner_id: [7, 'Fontana'], currency_id: [2, 'EUR'], amount_currency: -200 }]
        : [
            { id: 1, date: '2026-08-01', move_id: [70, 'BILL/2026/0001'], move_name: 'BILL/2026/0001', ref: 'FON-1', name: false, date_maturity: '2026-08-15', partner_id: [7, 'Fontana'], currency_id: [1, 'USD'], amount_currency: -1000, parent_state: 'posted' },
            { id: 2, date: '2026-08-09', move_id: [71, 'BNK1/2026/0003'], move_name: 'BNK1/2026/0003', ref: false, name: 'Payment to Fontana', date_maturity: false, partner_id: [7, 'Fontana'], currency_id: [1, 'USD'], amount_currency: 600, parent_state: 'posted' },
          ]
    else if (model === 'account.move' && method === 'read' && (args as number[][])[0]!.includes(70))
      result = [{ id: 70, move_type: 'in_invoice', journal_id: [2, 'Vendor Bills'] }, { id: 71, move_type: 'entry', journal_id: [5, 'Bank'] }]
    else if (model === 'account.journal' && method === 'read') result = [{ id: 2, type: 'purchase' }, { id: 5, type: 'bank' }]
    else if (model === 'res.partner' && method === 'search_read') {
      // The id ConsolFlora kept is customer 55, whose reference is PFJ.
      const d = (args as unknown[][])[0]!
      const id = (d.find((x) => Array.isArray(x) && x[0] === 'id') as unknown[] | undefined)?.[2]
      const ref = (d.find((x) => Array.isArray(x) && x[0] === 'ref') as unknown[] | undefined)?.[2]
      result = id === 55 && ref === 'PFJ' ? [{ id: 55 }] : []
    } else if (model === 'res.partner' && method === 'search')
      // A company already in Odoo under the buyer's name (no reference): id 77.
      result = (args as unknown[][])[0]!.some((d) => Array.isArray(d) && d[0] === 'name' && String(d[2]).toLowerCase() === 'existing buyer ltd') ? [77] : []
    else if (model === 'res.country' && method === 'search') result = [113]
    else if (model === 'res.partner' && method === 'create') result = 55
    else if (model === 'res.currency') result = [{ id: 1, active: opts.currencyActive ?? true }]
    else if (model === 'account.move' && method === 'search') result = opts.existingMove ? [opts.existingMove] : []
    else if (model === 'account.move' && method === 'create') result = 900
    else if (model === 'account.move' && ['action_post', 'button_draft', 'write'].includes(method)) result = true
    else if (model === 'account.move.send.wizard' && method === 'fields_get') result = { sending_methods: { type: 'json' } }
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
    await expect(client().test(['EUR', 'USD'])).resolves.toBe("Connected to Odoo 18.0 as api@consolflora.com: invoices can be created, 42 confirmed vendor bills can be read, EUR, USD are active, and Odoo's invoice PDFs can be made from ConsolFlora.")
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

  it('reads the supplier ledger: bills and payments, and the balance brought forward per currency', async () => {
    const calls = fakeOdoo()
    const r = await client().ledger({ side: 'supplier', from: '2026-07-01', to: '2026-09-30', partner: 'fontana', drafts: false })
    expect(r.lines.map((l) => [l.kind, l.number, l.reference, l.due_date, l.amount, l.currency])).toEqual([
      ['bill', 'BILL/2026/0001', 'FON-1', '2026-08-15', -1000, 'USD'],
      ['payment', 'BNK1/2026/0003', 'Payment to Fontana', null, 600, 'USD'],
    ])
    expect(r.opening).toEqual([{ partner_id: 7, partner: 'Fontana', currency: 'EUR', amount: -200 }])
    const domain = calls.find((c) => c.args[3] === 'account.move.line' && c.args[4] === 'search_read')!.args[5] as unknown[][]
    expect(domain[0]).toEqual(expect.arrayContaining([['account_id.account_type', '=', 'liability_payable'], ['parent_state', 'in', ['posted']], ['partner_id', 'ilike', 'fontana'], ['date', '>=', '2026-07-01']]))
    // Statements only read: nothing is written to Odoo.
    expect(calls.some((c) => ['create', 'write', 'action_post', 'button_draft', 'unlink'].includes(c.args[4] as string))).toBe(false)
  })

  it('a due date set by ConsolFlora replaces any Odoo payment term', async () => {
    const calls = fakeOdoo({ state: 'draft' })
    await client().push({ ...mapped, due_date: '2026-11-15' })
    const values = (calls.find((c) => c.args[3] === 'account.move' && c.args[4] === 'create')!.args[5] as Record<string, unknown>[])[0]!
    expect(values).toMatchObject({ invoice_date_due: '2026-11-15', invoice_payment_term_id: false })
  })

  it('a manual invoice sends its own lines', async () => {
    const calls = fakeOdoo({ state: 'draft' })
    await client().push({ ...payload, lines: [{ name: 'Sleeves', quantity: 200, price_unit: 0.15 }, { name: 'Boxes', quantity: 3, price_unit: 12.5 }] })
    const values = (calls.find((c) => c.args[3] === 'account.move' && c.args[4] === 'create')!.args[5] as Record<string, unknown>[])[0]!
    expect(values.invoice_line_ids).toEqual([[0, 0, { name: 'Sleeves', quantity: 200, price_unit: 0.15 }], [0, 0, { name: 'Boxes', quantity: 3, price_unit: 12.5 }]])
  })

  it('lists Odoo documents by side, name, dates, number or reference, status and payment', () => {
    expect(moveDomain({ side: 'in', partner: 'fontana', from: '2026-01-01', to: '2026-10-08', search: 'FON-12', state: 'posted', payment: 'unpaid', offset: 0, limit: 50 })).toEqual([
      ['move_type', 'in', ['in_invoice', 'in_refund']],
      ['partner_id', 'ilike', 'fontana'],
      ['date', '>=', '2026-01-01'],
      ['date', '<=', '2026-10-08'],
      '|', ['name', 'ilike', 'FON-12'], ['ref', 'ilike', 'FON-12'],
      ['state', '=', 'posted'],
      ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']],
    ])
    expect(moveDomain({ side: 'out', partner: null, from: null, to: null, search: null, state: 'all', payment: 'all', offset: 0, limit: 50 })).toEqual([['move_type', 'in', ['out_invoice', 'out_refund']]])
  })

  /** A fake Odoo for the PDF step: which Send & Print wizard exists, and whether the PDF appears. */
  function fakePdfOdoo(opts: { version: 17 | 18; state?: string; hasPdf?: boolean; makes?: boolean }) {
    const calls: Call[] = []
    let pdf = opts.hasPdf ?? false
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const { params } = JSON.parse(init.body) as { params: Call }
      calls.push(params)
      const [, , , model, method] = params.args as [string, number, string, string, string]
      let result: unknown = null
      let error: string | null = null
      if (params.method === 'authenticate') result = 2
      else if (model === 'ir.attachment' && method === 'search_count') result = pdf ? 1 : 0
      else if (model === 'account.move' && method === 'read') result = [{ state: opts.state ?? 'posted', name: 'INV/2026/00089', payment_state: 'not_paid', amount_residual: 10, invoice_date_due: false }]
      else if (model === 'account.move.send.wizard') {
        if (opts.version !== 18) error = "Object account.move.send.wizard doesn't exist"
        else if (method === 'create') result = 5
        else if (method === 'action_send_and_print') pdf = opts.makes ?? true
      } else if (model === 'account.move.send') {
        if (opts.version !== 17) error = "Object account.move.send doesn't exist"
        else if (method === 'create') result = 6
        else if (method === 'action_send_and_print') pdf = opts.makes ?? true
      }
      return { ok: true, json: async () => (error ? { jsonrpc: '2.0', id: 1, error: { message: error } } : { jsonrpc: '2.0', id: 1, result }) }
    })
    return calls
  }
  const wizardCalls = (calls: Call[]) => calls.filter((c) => String(c.args[3]).startsWith('account.move.send')).map((c) => [c.args[3], c.args[4], c.args[5]])

  it("Odoo 18+: makes the invoice PDF with Send & Print, every way of sending switched off", async () => {
    const calls = fakePdfOdoo({ version: 18 })
    await expect(client().makePdf(89)).resolves.toEqual({ made: true, message: 'Odoo made its PDF.' })
    expect(wizardCalls(calls)).toEqual([
      ['account.move.send.wizard', 'create', [{ move_id: 89, sending_methods: [] }]],
      ['account.move.send.wizard', 'action_send_and_print', [[5]]],
    ])
    expect(calls.find((c) => c.args[4] === 'create')!.args[6]).toEqual({ context: { active_model: 'account.move', active_ids: [89], active_id: 89 } })
  })

  it('Odoo 17: the older wizard, with email off', async () => {
    const calls = fakePdfOdoo({ version: 17 })
    await expect(client().makePdf(89)).resolves.toMatchObject({ made: true })
    expect(wizardCalls(calls).filter((c) => c[0] === 'account.move.send')).toEqual([
      ['account.move.send', 'create', [{ checkbox_send_mail: false, checkbox_download: false }]],
      ['account.move.send', 'action_send_and_print', [[6]]],
    ])
  })

  it('never emails: no wizard is ever created without its email-off values', async () => {
    for (const version of [17, 18] as const) {
      const calls = fakePdfOdoo({ version })
      await client().makePdf(89)
      for (const c of calls.filter((x) => String(x.args[3]).startsWith('account.move.send') && x.args[4] === 'create')) {
        const values = (c.args[5] as Record<string, unknown>[])[0]!
        expect(values.sending_methods ?? values.checkbox_send_mail).toEqual(c.args[3] === 'account.move.send.wizard' ? [] : false)
      }
    }
  })

  it('a PDF already there, a draft, or Odoo not making it', async () => {
    let calls = fakePdfOdoo({ version: 18, hasPdf: true })
    await expect(client().makePdf(89)).resolves.toEqual({ made: false, message: 'Odoo already has its PDF.' })
    expect(wizardCalls(calls)).toEqual([])
    calls = fakePdfOdoo({ version: 18, state: 'draft' })
    await expect(client().makePdf(89)).rejects.toThrow('once the invoice is confirmed')
    expect(wizardCalls(calls)).toEqual([])
    fakePdfOdoo({ version: 18, makes: false })
    await expect(client().makePdf(89)).rejects.toThrow('Press Print on the invoice in Odoo once')
  })

  it("finds Odoo 17+'s invoice PDF, which is a field attachment", () => {
    expect(pdfDomain(89)).toEqual([['res_model', '=', 'account.move'], ['res_id', '=', 89], ['mimetype', '=', 'application/pdf'], '|', ['res_field', '=', false], ['res_field', '!=', false]])
  })

  it("a kept Odoo customer id is used only if it is still that buyer's; otherwise the buyer is found by code", async () => {
    let calls = fakeOdoo({ state: 'draft' })
    await client().push({ ...payload, partner: { ...payload.partner, odoo_partner_id: 55 } })
    expect((calls.find((c) => c.args[3] === 'account.move' && c.args[4] === 'create')!.args[5] as Record<string, unknown>[])[0]!.partner_id).toBe(55)
    // An id from the preview's demo Odoo (another company in the real Odoo): not used.
    calls = fakeOdoo({ state: 'draft' })
    await client().push({ ...payload, partner: { ...payload.partner, odoo_partner_id: 1234 } })
    expect((calls.find((c) => c.args[3] === 'account.move' && c.args[4] === 'create')!.args[5] as Record<string, unknown>[])[0]!.partner_id).toBe(55)
    expect(calls.some((c) => c.args[3] === 'res.partner' && c.args[4] === 'create')).toBe(true)
  })

  it('default recipients: invoice addresses, else the company email, else ConsolFlora\'s contact', () => {
    const c = (o: Partial<OdooContact>): OdooContact => ({ id: 1, name: 'x', company: null, is_company: false, type: 'contact', email: null, phone: null, job: null, ref: null, buyer: true, grower: false, ...o })
    const company = c({ is_company: true, email: 'orders@pfj.example' })
    expect(defaultRecipients([company, c({ email: 'aiko@pfj.example' }), c({ type: 'invoice', email: 'accounts@pfj.example' })], 'x@y.z')).toEqual(['accounts@pfj.example'])
    expect(defaultRecipients([company, c({ email: 'aiko@pfj.example' })], 'x@y.z')).toEqual(['orders@pfj.example'])
    expect(defaultRecipients([c({ email: 'aiko@pfj.example' })], 'x@y.z')).toEqual(['x@y.z'])
  })

  it('contacts: buyers or growers (also people under them), searched by name, email or company', () => {
    expect(contactDomain({ kind: 'growers', search: 'fontana' })).toEqual([
      '|', ['supplier_rank', '>', 0], ['parent_id.supplier_rank', '>', 0],
      '|', '|', ['name', 'ilike', 'fontana'], ['email', 'ilike', 'fontana'], ['parent_id.name', 'ilike', 'fontana'],
    ])
  })

  it('an existing Odoo company with the same name is used, never duplicated', async () => {
    const calls = fakeOdoo({ state: 'draft' })
    await client().push({ ...payload, partner: { ...payload.partner, name: 'EXISTING BUYER LTD', code: 'EXB' } })
    expect((calls.find((c) => c.args[3] === 'account.move' && c.args[4] === 'create')!.args[5] as Record<string, unknown>[])[0]!.partner_id).toBe(77)
    expect(calls.some((c) => c.args[3] === 'res.partner' && c.args[4] === 'create')).toBe(false)
  })
})
