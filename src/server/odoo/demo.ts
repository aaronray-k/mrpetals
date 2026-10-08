import { MAPPED_FIELDS, lineLabel, type InvoicePayload, type LedgerLine, type LedgerQuery, type LedgerResult, type OdooAdapter, type OdooMove, type OdooMoveDetail } from './client'

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
      all.push({ id: id++, date: iso(date), number, reference: a.side === 'supplier' ? `${a.partner.split(' ')[0]!.toUpperCase()}-${a.currency}-${1000 + n}` : `CFL${a.partner.slice(0, 3).toUpperCase()}${String(n).padStart(4, '0')}`, due_date: iso(plus(date, a.terms)), partner_id: a.partner_id, partner: a.partner, currency: a.currency, amount: sign * amount, kind: a.side === 'supplier' ? 'bill' : 'invoice', draft })
      if (!draft) unpaid += amount
      if (n % 9 === 0) {
        const credit = Math.round(amount * 0.08 * 100) / 100
        all.push({ id: id++, date: iso(plus(date, 3)), number: `${a.side === 'supplier' ? 'RBILL' : 'RINV'}/${year}/${String(a.partner_id).slice(1)}${String(n).padStart(3, '0')}`, reference: `Claim credit on ${number}`, due_date: null, partner_id: a.partner_id, partner: a.partner, currency: a.currency, amount: -sign * credit, kind: a.side === 'supplier' ? 'refund' : 'credit_note', draft: false })
        unpaid -= credit
      }
      // Payments: every few weeks, most of what is open (the latest weeks stay unpaid).
      if (n % a.paysEvery === 0 && w > 1) {
        const paid = Math.round(unpaid * (w > 6 ? 1 : 0.6) * 100) / 100
        if (paid > 0) {
          all.push({ id: id++, date: iso(plus(date, 5)), number: `${a.currency === 'EUR' ? 'BNK2' : 'BNK1'}/${year}/${String(id).padStart(5, '0')}`, reference: a.side === 'supplier' ? `Payment to ${a.partner}` : `Payment from ${a.partner}`, due_date: null, partner_id: a.partner_id, partner: a.partner, currency: a.currency, amount: -sign * paid, kind: 'payment', draft: false })
          unpaid -= paid
        }
      }
    }
  }
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

/**
 * PREVIEW ONLY: a stand-in for Odoo, used when ODOO_SOURCE=demo. Invoices arrive as drafts with Odoo-style
 * fields; confirming gives them a number, and the demo buyer "pays" each a few minutes after it is confirmed.
 */
export function demoOdoo(nextNumber: (kind: InvoicePayload['kind']) => Promise<number>): OdooAdapter {
  const year = new Date().getFullYear()
  const moveId = (p: InvoicePayload) => parseInt(p.invoice_id.replace(/-/g, '').slice(0, 7), 16)
  const day = (iso: string) => iso.slice(0, 10)
  const due = (p: InvoicePayload, from: string) => {
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
      due_date: s === 'posted' ? due(p, day(p.posted_at ?? new Date().toISOString())) : null,
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
      return {
        ...s,
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
        lines: [{ name: lineLabel(p), quantity: 1, price_unit: p.amount, subtotal: p.amount }],
        fields: MAPPED_FIELDS.filter((f) => p.field_map?.[f.key]).map((f) => ({ key: f.key, field: p.field_map![f.key]!, value: p[f.key] ?? null })),
        has_pdf: false,
      }
    },
    async pdf() {
      return null
    },
    async confirm(p) {
      // Like Odoo: a number once given is kept through a reset to draft.
      const name = p.odoo_name && p.odoo_name !== '/' ? p.odoo_name : `${p.kind === 'invoice' ? 'INV' : 'RINV'}/${year}/${String(await nextNumber(p.kind)).padStart(5, '0')}`
      return state({ ...p, posted_at: p.posted_at ?? new Date().toISOString() }, 'posted', name)
    },
    async resetToDraft(p) {
      if (state(p, p.odoo_state ?? 'draft').payment_state === 'paid') throw new Error('This invoice is paid; Odoo can\'t reset it to draft.')
      return state(p, 'draft', p.odoo_name ?? '')
    },
    async ledger(q) {
      return demoLedger(q)
    },
    async updateDraft(p) {
      if ((p.odoo_state ?? 'draft') !== 'draft') throw new Error('Only a draft can be changed. Reset it to draft first.')
      return state(p, 'draft', p.odoo_name ?? '')
    },
  }
}
