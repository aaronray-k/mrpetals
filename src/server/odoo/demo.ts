import type { InvoicePayload, OdooAdapter, OdooMove } from './client'

/**
 * PREVIEW ONLY: a stand-in for Odoo, used when ODOO_SOURCE=demo. Invoices get Odoo-style numbers, and the
 * demo buyer "pays" each invoice a few minutes after it is posted, so the paid flow can be seen.
 */
export function demoOdoo(nextNumber: (kind: InvoicePayload['kind']) => Promise<number>): OdooAdapter {
  const year = new Date().getFullYear()
  const moveId = (p: InvoicePayload) => parseInt(p.invoice_id.replace(/-/g, '').slice(0, 7), 16)
  const state = (p: InvoicePayload, name: string): OdooMove => {
    const minutes = p.pushed_at ? (Date.now() - Date.parse(p.pushed_at)) / 60000 : 0
    const paid = p.orders_paid || minutes >= 3
    return {
      move_id: moveId(p),
      name,
      state: 'posted',
      payment_state: paid ? 'paid' : 'not_paid',
      amount_due: paid ? 0 : p.amount,
      url: `https://demo.odoo.example/web#id=${moveId(p)}&model=account.move&view_type=form`,
      source: 'demo',
    }
  }
  return {
    async test() {
      return 'Connected to the demo Odoo (preview only).'
    },
    async push(p) {
      const n = await nextNumber(p.kind)
      const name = `${p.kind === 'invoice' ? 'INV' : 'RINV'}/${year}/${String(n).padStart(5, '0')}`
      return { ...state({ ...p, pushed_at: new Date().toISOString() }, name), partner_id: 1000 + (parseInt(p.partner.code, 36) % 1000) }
    },
    async fetch(p) {
      return state(p, '')
    },
  }
}
