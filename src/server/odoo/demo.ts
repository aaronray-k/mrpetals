import { PDFDocument, StandardFonts } from 'pdf-lib'
import { MAPPED_FIELDS, lineLabel, type InvoicePayload, type LedgerLine, type LedgerQuery, type LedgerResult, type ContactQuery, type MoveQuery, type OdooAdapter, type OdooContact, type OdooMove, type OdooMoveDetail, type OdooMoveSummary } from './client'

const TERMS = [
  { id: 1, name: 'Immediate Payment' },
  { id: 2, name: '15 Days' },
  { id: 3, name: '21 Days' },
  { id: 4, name: '30 Days' },
  { id: 5, name: '45 Days' },
  { id: 6, name: '60 Days' },
]
const termDays = (id: number | null | undefined) => (id ? parseInt(TERMS.find((t) => t.id === id)?.name ?? '0', 10) || 0 : null)

// The demo ledger: suppliers (one with a USD and a EUR account) and buyers, about six months of bills,
// invoices, refunds and payments, some paid in full, some part-paid, a few drafts.
const DEMO_ACCOUNTS: { side: LedgerQuery['side']; partner_id: number; partner: string; currency: string; size: number; terms: number; paysEvery: number }[] = [
  { side: 'supplier', partner_id: 201, partner: 'Fontana', currency: 'USD', size: 2400, terms: 15, paysEvery: 2 },
  { side: 'supplier', partner_id: 201, partner: 'Fontana', currency: 'EUR', size: 1600, terms: 30, paysEvery: 3 },
  { side: 'supplier', partner_id: 202, partner: 'Kibo Roses Ltd', currency: 'USD', size: 1800, terms: 15, paysEvery: 2 },
  { side: 'supplier', partner_id: 203, partner: 'Naku Flowers', currency: 'USD', size: 950, terms: 15, paysEvery: 1 },
  { side: 'supplier', partner_id: 204, partner: 'Oleria Growers', currency: 'USD', size: 1200, terms: 30, paysEvery: 4 },
  { side: 'buyer', partner_id: 301, partner: 'Pacific Floral Japan GK', currency: 'USD', size: 5200, terms: 0, paysEvery: 1 },
  { side: 'buyer', partner_id: 302, partner: 'Bloem Handel BV', currency: 'EUR', size: 3900, terms: 30, paysEvery: 2 },
]
export function demoLedger(q: LedgerQuery, today = new Date()): LedgerResult {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const plus = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000)
  const all: LedgerLine[] = []
  let id = 1
  for (const a of DEMO_ACCOUNTS.filter((x) => x.side === q.side)) {
    const sign = a.side === 'supplier' ? -1 : 1 // Odoo: a supplier bill is a credit on payables, a buyer invoice a debit on receivables
    const prefix = a.side === 'supplier' ? 'BILL' : 'INV'
    let unpaid = 0
    for (let w = 26; w >= 0; w--) {
      const date = plus(today, -7 * w - (a.partner_id % 3))
      if (date > today) continue
      const n = 26 - w + 1
      const amount = Math.round(a.size * (0.75 + ((n * 37 + a.partner_id) % 50) / 100) * 100) / 100
      const year = date.getUTCFullYear()
      const draft = w === 0 && a.partner_id % 2 === 0
      const number = draft ? '/' : `${prefix}/${year}/${String(a.partner_id).slice(1)}${String(n).padStart(3, '0')}`
      // Buyers: each week's invoice is one flight's air waybill.
      const mawb = a.side === 'buyer' ? `176-${String(9000000 + a.partner_id * 100 + n).padStart(8, '0')}` : null
      all.push({ id: id++, move_id: 0, date: iso(date), number, reference: a.side === 'supplier' ? `${a.partner.split(' ')[0]!.toUpperCase()}-${a.currency}-${1000 + n}` : `CFL${a.partner.slice(0, 3).toUpperCase()}${String(n).padStart(4, '0')}`, due_date: iso(plus(date, a.terms)), partner_id: a.partner_id, partner: a.partner, currency: a.currency, amount: sign * amount, kind: a.side === 'supplier' ? 'bill' : 'invoice', draft, mawb })
      if (!draft) unpaid += amount
      if (n % 9 === 0) {
        const credit = Math.round(amount * 0.08 * 100) / 100
        all.push({ id: id++, move_id: 0, date: iso(plus(date, 3)), number: `${a.side === 'supplier' ? 'RBILL' : 'RINV'}/${year}/${String(a.partner_id).slice(1)}${String(n).padStart(3, '0')}`, reference: `Claim credit on ${number}`, due_date: null, partner_id: a.partner_id, partner: a.partner, currency: a.currency, amount: -sign * credit, kind: a.side === 'supplier' ? 'refund' : 'credit_note', draft: false, mawb })
        unpaid -= credit
      }
      // Payments: every few weeks, most of what is open (the latest weeks stay unpaid).
      if (n % a.paysEvery === 0 && w > 1) {
        const paid = Math.round(unpaid * (w > 6 ? 1 : 0.6) * 100) / 100
        if (paid > 0) {
          all.push({ id: id++, move_id: 0, date: iso(plus(date, 5)), number: `${a.currency === 'EUR' ? 'BNK2' : 'BNK1'}/${year}/${String(id).padStart(5, '0')}`, reference: a.side === 'supplier' ? `Payment to ${a.partner}` : `Payment from ${a.partner}`, due_date: null, partner_id: a.partner_id, partner: a.partner, currency: a.currency, amount: -sign * paid, kind: 'payment', draft: false })
          unpaid -= paid
        }
      }
    }
  }
  for (const l of all) l.move_id = 900000 + l.id
  const todayIso = iso(today)
  const lines = all
    .filter((l) => (q.drafts || !l.draft) && l.date <= q.to && l.date <= todayIso && (!q.partner || l.partner.toLowerCase().includes(q.partner.toLowerCase())))
    .sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id)
  const opening = new Map<string, LedgerResult['opening'][number]>()
  for (const l of lines.filter((x) => q.from && x.date < q.from)) {
    const key = `${l.partner_id}|${l.currency}`
    const o = opening.get(key) ?? { partner_id: l.partner_id, partner: l.partner, currency: l.currency, amount: 0 }
    o.amount += l.amount
    opening.set(key, o)
  }
  return { lines: lines.filter((l) => !q.from || l.date >= q.from), opening: [...opening.values()] }
}

// The demo's documents (for "All invoices in Odoo"): every bill, refund, invoice and credit note of the demo
// ledger, with what is still due worked out from the payments (oldest first). Confirm and reset are kept in memory.
const MOVE_TYPE: Partial<Record<LedgerLine['kind'], string>> = { bill: 'in_invoice', refund: 'in_refund', invoice: 'out_invoice', credit_note: 'out_refund' }
const demoStates = new Map<number, string>()
function demoMoves(today = new Date()): OdooMoveSummary[] {
  const out: OdooMoveSummary[] = []
  for (const side of ['supplier', 'buyer'] as const) {
    const { lines } = demoLedger({ side, from: null, to: today.toISOString().slice(0, 10), partner: null, drafts: true }, today)
    const open = new Map<string, OdooMoveSummary[]>()
    for (const l of lines) {
      const sign = side === 'supplier' ? -1 : 1
      const v = sign * l.amount
      const key = `${l.partner_id}|${l.currency}`
      const queue = open.get(key) ?? []
      open.set(key, queue)
      const type = MOVE_TYPE[l.kind]
      const doc: OdooMoveSummary | null = type
        ? { move_id: 900000 + l.id, move_type: type, name: l.number, partner: l.partner, date: l.date, due_date: l.due_date, reference: l.reference, currency: l.currency, amount_total: Math.abs(l.amount), amount_due: 0, state: l.draft ? 'draft' : 'posted', payment_state: 'not_paid' }
        : null
      if (doc) out.push(doc)
      if (v > 0 && doc && !l.draft) {
        doc.amount_due = v
        queue.push(doc)
      } else if (v < 0) {
        let c = -v
        while (c > 0.004 && queue.length) {
          const take = Math.min(c, queue[0]!.amount_due)
          queue[0]!.amount_due = Math.round((queue[0]!.amount_due - take) * 100) / 100
          c -= take
          if (queue[0]!.amount_due <= 0) queue.shift()
        }
        if (doc) doc.payment_state = 'paid'
      }
    }
  }
  for (const m of out) {
    m.state = demoStates.get(m.move_id) ?? m.state
    if (m.state === 'posted' && m.name === '/') m.name = `${m.move_type.startsWith('in') ? 'BILL' : 'INV'}/${(m.date ?? '').slice(0, 4)}/D${m.move_id - 900000}`
    if (m.move_type.endsWith('invoice')) m.payment_state = m.state !== 'posted' ? 'not_paid' : m.amount_due <= 0 ? 'paid' : m.amount_due < m.amount_total ? 'partial' : 'not_paid'
    if (m.state === 'draft') m.amount_due = m.amount_total
  }
  return out
}
// Demo PDFs ("made by Odoo"), and the last preview of each invoice they are drawn from. In memory, like Odoo's store.
const demoPdfs = new Map<number, string>()
const seen = new Map<number, OdooMoveDetail>()
const remember = (d: OdooMoveDetail) => {
  seen.set(d.move_id, d)
  return { ...d, has_pdf: demoPdfs.has(d.move_id) }
}
async function demoPdf(d: OdooMoveDetail): Promise<string> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let y = 790
  const text = (t: string, x: number, size = 10, f = font) => page.drawText(t.replace(/[^\x20-\x7e\xa0-\xff]/g, '?'), { x, y, size, font: f })
  text('Demo Odoo: sample PDF (preview only)', 50, 9)
  y -= 30
  text(`${d.move_type.endsWith('refund') ? 'Credit note' : d.move_type.startsWith('in') ? 'Bill' : 'Invoice'} ${d.name}`, 50, 18, bold)
  y -= 26
  text(d.company ?? '', 50)
  y -= 14
  text(`${d.move_type.startsWith('in') ? 'From' : 'Bill to'}: ${d.partner ?? ''}`, 50)
  y -= 14
  text(`Date: ${d.invoice_date ?? ''}   Due: ${d.due_date ?? ''}   Reference: ${d.reference ?? ''}`, 50)
  y -= 30
  text('Description', 50, 10, bold)
  text('Qty', 340, 10, bold)
  text('Price', 400, 10, bold)
  text('Amount', 480, 10, bold)
  for (const l of d.lines) {
    y -= 16
    text(l.name.slice(0, 50), 50)
    text(String(l.quantity), 340)
    text(l.price_unit.toFixed(2), 400)
    text(l.subtotal.toFixed(2), 480)
  }
  y -= 30
  text(`Total ${d.currency ?? ''} ${d.amount_total.toFixed(2)}`, 400, 12, bold)
  return Buffer.from(await doc.save()).toString('base64')
}

// Demo contacts: the demo buyers and growers, with their people and invoice addresses.
const contact = (id: number, name: string, o: Partial<OdooContact> = {}): OdooContact => ({
  id, name, company: null, is_company: false, type: 'contact', email: null, phone: null, job: null, ref: null, buyer: false, grower: false, ...o,
})
const DEMO_CONTACTS: OdooContact[] = [
  contact(5001, 'Pacific Floral Japan GK', { is_company: true, ref: 'PFJ', email: 'orders@pfj.example', phone: '+81 3 5555 0101', buyer: true }),
  contact(5002, 'Aiko Tanaka', { company: 'Pacific Floral Japan GK', email: 'aiko.tanaka@pfj.example', job: 'Buyer', buyer: true }),
  contact(5003, 'PFJ Accounts Payable', { company: 'Pacific Floral Japan GK', type: 'invoice', email: 'accounts@pfj.example', buyer: true }),
  contact(5011, 'Bloem Handel BV', { is_company: true, ref: 'BLM', email: 'inkoop@bloem.example', phone: '+31 297 555 010', buyer: true }),
  contact(5012, 'Jan de Vries', { company: 'Bloem Handel BV', email: 'jan@bloem.example', job: 'Inkoper', buyer: true }),
  contact(5013, 'Bloem Crediteuren', { company: 'Bloem Handel BV', type: 'invoice', email: 'facturen@bloem.example', buyer: true }),
  contact(5021, 'Fontana', { is_company: true, ref: 'FONT', email: 'sales@fontana.example', grower: true }),
  contact(5022, 'Fontana Accounts', { company: 'Fontana', type: 'invoice', email: 'accounts@fontana.example', grower: true }),
  contact(5031, 'Kibo Roses Ltd', { is_company: true, ref: 'KIBO', email: 'sales@kibo.example', grower: true }),
  contact(5032, 'Grace Wanjiku', { company: 'Kibo Roses Ltd', email: 'grace@kibo.example', job: 'Sales agent', grower: true }),
  contact(5041, 'Naku Flowers', { is_company: true, ref: 'NAKU', email: 'sales@naku.example', grower: true }),
  contact(5051, 'Oleria Growers', { is_company: true, ref: 'OLER', email: 'sales@oleria.example', grower: true }),
]

function demoMove(id: number): OdooMoveSummary {
  const m = demoMoves().find((x) => x.move_id === id)
  if (!m) throw new Error(`Odoo invoice ${id} no longer exists.`)
  return m
}

/**
 * PREVIEW ONLY: a stand-in for Odoo, used when ODOO_SOURCE=demo. Invoices arrive as drafts with Odoo-style
 * fields; confirming gives them a number, and the demo buyer "pays" each a few minutes after it is confirmed.
 */
export function demoOdoo(nextNumber: (kind: InvoicePayload['kind']) => Promise<number>): OdooAdapter {
  const year = new Date().getFullYear()
  const moveId = (p: InvoicePayload) => parseInt(p.invoice_id.replace(/-/g, '').slice(0, 7), 16)
  const day = (iso: string) => iso.slice(0, 10)
  const due = (p: InvoicePayload, from: string) => {
    if (p.due_date) return p.due_date
    const d = termDays(p.payment_term_id)
    return d == null ? from : day(new Date(Date.parse(from) + d * 86_400_000).toISOString())
  }
  const state = (p: InvoicePayload, s: string, name = ''): OdooMove => {
    const minutes = p.posted_at ? (Date.now() - Date.parse(p.posted_at)) / 60000 : 0
    const paid = s === 'posted' && (p.orders_paid || minutes >= 3)
    return {
      move_id: moveId(p),
      name: s === 'draft' && !name ? '/' : name,
      state: s,
      payment_state: paid ? 'paid' : 'not_paid',
      amount_due: paid ? 0 : p.amount,
      due_date: s === 'posted' ? due(p, day(p.posted_at ?? new Date().toISOString())) : (p.due_date ?? null),
      url: `https://demo.odoo.example/web#id=${moveId(p)}&model=account.move&view_type=form`,
      source: 'demo',
    }
  }
  return {
    async test() {
      return 'Connected to the demo Odoo (preview only).'
    },
    async push(p) {
      return { ...state(p, 'draft'), partner_id: 1000 + (parseInt(p.partner.code, 36) % 1000) }
    },
    async fetch(p) {
      return state(p, p.odoo_state ?? 'draft', p.odoo_name ?? '')
    },
    async fields() {
      return [
        { name: 'x_studio_mawb', label: 'MAWB', type: 'char' },
        { name: 'x_studio_proforma_invoice_no', label: 'Proforma Invoice No', type: 'char' },
        { name: 'x_studio_flight_number', label: 'Flight Number', type: 'char' },
        { name: 'narration', label: 'Terms and Conditions', type: 'text' },
        { name: 'ref', label: 'Customer Reference', type: 'char' },
      ]
    },
    async paymentTerms() {
      return TERMS
    },
    async detail(p): Promise<OdooMoveDetail> {
      const s = state(p, p.odoo_state ?? 'draft', p.odoo_name ?? '')
      return remember({
        ...s,
        move_type: p.kind === 'invoice' ? 'out_invoice' : 'out_refund',
        due_date: s.due_date ?? null,
        partner: p.partner.name,
        company: 'ConsolFlora (demo)',
        currency: p.currency,
        reference: p.reference,
        invoice_date: p.posted_at && s.state === 'posted' ? day(p.posted_at) : null,
        payment_term: TERMS.find((t) => t.id === p.payment_term_id)?.name ?? null,
        amount_untaxed: p.amount,
        amount_tax: 0,
        amount_total: p.amount,
        lines: p.lines?.length
          ? p.lines.map((l) => ({ ...l, subtotal: Math.round(l.quantity * l.price_unit * 100) / 100 }))
          : [{ name: lineLabel(p), quantity: 1, price_unit: p.amount, subtotal: p.amount }],
        fields: MAPPED_FIELDS.filter((f) => p.field_map?.[f.key]).map((f) => ({ key: f.key, field: p.field_map![f.key]!, value: p[f.key] ?? null })),
        has_pdf: false,
      })
    },
    async pdf(p) {
      return this.movePdf(moveId(p))
    },
    async confirm(p) {
      // Like Odoo: a number once given is kept through a reset to draft.
      const name = p.odoo_name && p.odoo_name !== '/' ? p.odoo_name : `${p.kind === 'invoice' ? 'INV' : 'RINV'}/${year}/${String(await nextNumber(p.kind)).padStart(5, '0')}`
      const r = state({ ...p, posted_at: p.posted_at ?? new Date().toISOString() }, 'posted', name)
      const d = seen.get(r.move_id)
      if (d) seen.set(r.move_id, { ...d, state: 'posted', name, invoice_date: day(new Date().toISOString()), due_date: r.due_date ?? d.due_date })
      return r
    },
    async resetToDraft(p) {
      if (state(p, p.odoo_state ?? 'draft').payment_state === 'paid') throw new Error('This invoice is paid; Odoo can\'t reset it to draft.')
      return state(p, 'draft', p.odoo_name ?? '')
    },
    async ledger(q) {
      return demoLedger(q)
    },
    async contacts(q: ContactQuery) {
      const needle = q.search?.toLowerCase()
      const all = DEMO_CONTACTS.filter((c) => (q.kind === 'buyers' ? c.buyer : q.kind === 'growers' ? c.grower : true)).filter(
        (c) => !needle || [c.name, c.email ?? '', c.company ?? ''].some((x) => x.toLowerCase().includes(needle)),
      )
      return { total: all.length, contacts: [...all].sort((a, b) => a.name.localeCompare(b.name)).slice(q.offset, q.offset + q.limit) }
    },
    async contactsOf(p) {
      const company = DEMO_CONTACTS.find((c) => c.is_company && c.ref === p.code)
      return company ? DEMO_CONTACTS.filter((c) => c === company || c.company === company.name) : []
    },
    async moves(q: MoveQuery) {
      const types = q.side === 'out' ? ['out_invoice', 'out_refund'] : ['in_invoice', 'in_refund']
      const needle = q.search?.toLowerCase()
      const all = demoMoves()
        .filter((m) => types.includes(m.move_type))
        .filter((m) => !q.partner || (m.partner ?? '').toLowerCase().includes(q.partner.toLowerCase()))
        .filter((m) => (!q.from || (m.date ?? '') >= q.from) && (!q.to || (m.date ?? '') <= q.to))
        .filter((m) => !needle || m.name.toLowerCase().includes(needle) || (m.reference ?? '').toLowerCase().includes(needle))
        .filter((m) => q.state === 'all' || m.state === q.state)
        .filter((m) => q.payment === 'all' || (q.payment === 'paid' ? m.payment_state === 'paid' : m.state === 'posted' && ['not_paid', 'partial'].includes(m.payment_state)))
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.move_id - a.move_id)
      const due = new Map<string, number>()
      for (const m of all) if (m.state === 'posted' && m.amount_due > 0) due.set(m.currency, (due.get(m.currency) ?? 0) + m.amount_due)
      return {
        total: all.length,
        moves: all.slice(q.offset, q.offset + q.limit),
        due: [...due].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })).sort((a, b) => a.currency.localeCompare(b.currency)),
      }
    },
    async moveDetail(id): Promise<OdooMoveDetail> {
      const m = demoMove(id)
      return remember({
        move_id: id, move_type: m.move_type, name: m.state === 'draft' ? '/' : m.name, state: m.state, payment_state: m.payment_state, amount_due: m.amount_due,
        url: `https://demo.odoo.example/web#id=${id}&model=account.move&view_type=form`, due_date: m.due_date, invoice_date: m.date, partner: m.partner,
        company: 'ConsolFlora (demo)', currency: m.currency, reference: m.reference, payment_term: null,
        amount_untaxed: m.amount_total, amount_tax: 0, amount_total: m.amount_total,
        lines: [{ name: m.move_type.startsWith('in') ? 'Cut flowers (grower bill)' : 'Cut Flowers', quantity: 1, price_unit: m.amount_total, subtotal: m.amount_total }],
        fields: [], has_pdf: false, source: 'demo',
      })
    },
    async movePdf(id) {
      const b = demoPdfs.get(id)
      return b ? { name: `${(seen.get(id)?.name ?? 'invoice').replace(/\//g, '_')}.pdf`, base64: b } : null
    },
    async lineProduct(name) {
      return { id: 7001, name, created: false }
    },
    async makePdf(id) {
      if (demoPdfs.has(id)) return { made: false, message: 'Odoo already has its PDF.' }
      // A demo ledger document is worked out afresh (its state may have changed); a ConsolFlora invoice comes from its last preview.
      const d = demoMoves().some((m) => m.move_id === id) ? await this.moveDetail(id) : (seen.get(id) ?? null)
      if (!d) throw new Error('Open the invoice once first (demo Odoo).')
      if (d.state !== 'posted') throw new Error('Odoo makes the PDF once the invoice is confirmed.')
      demoPdfs.set(id, await demoPdf(d))
      return { made: true, message: 'Odoo made its PDF.' }
    },
    async moveAction(id, action) {
      const m = demoMove(id)
      if (action === 'reset' && m.payment_state === 'paid') throw new Error('This invoice is paid; Odoo can\'t reset it to draft.')
      demoStates.set(id, action === 'confirm' ? 'posted' : 'draft')
      const after = demoMove(id)
      return { move_id: id, name: after.name, state: after.state, payment_state: after.payment_state, amount_due: after.amount_due, due_date: after.due_date, url: '', source: 'demo' }
    },
    async updateDraft(p) {
      if ((p.odoo_state ?? 'draft') !== 'draft') throw new Error('Only a draft can be changed. Reset it to draft first.')
      return state(p, 'draft', p.odoo_name ?? '')
    },
  }
}
