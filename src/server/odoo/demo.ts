import { MAPPED_FIELDS, lineLabel, type InvoicePayload, type OdooAdapter, type OdooMove, type OdooMoveDetail } from './client'

const TERMS = [
  { id: 1, name: 'Immediate Payment' },
  { id: 2, name: '15 Days' },
  { id: 3, name: '21 Days' },
  { id: 4, name: '30 Days' },
  { id: 5, name: '45 Days' },
  { id: 6, name: '60 Days' },
]
const termDays = (id: number | null | undefined) => (id ? parseInt(TERMS.find((t) => t.id === id)?.name ?? '0', 10) || 0 : null)

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
    async updateDraft(p) {
      if ((p.odoo_state ?? 'draft') !== 'draft') throw new Error('Only a draft can be changed. Reset it to draft first.')
      return state(p, 'draft', p.odoo_name ?? '')
    },
  }
}
