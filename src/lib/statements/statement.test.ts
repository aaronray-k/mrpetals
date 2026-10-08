import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { LedgerLine, LedgerResult } from '~/server/odoo/client'
import { demoLedger } from '~/server/odoo/demo'
import { buildStatementSheet } from './excel'
import { statementPdf } from './pdf'
import { buildStatement, type StatementFilters } from './statement'

let id = 0
const line = (l: Partial<LedgerLine> & Pick<LedgerLine, 'date' | 'amount' | 'kind'>): LedgerLine => ({
  id: ++id,
  number: `N${id}`,
  reference: null,
  due_date: null,
  partner_id: 1,
  partner: 'Fontana',
  currency: 'USD',
  draft: false,
  ...l,
})
const filters: StatementFilters = { side: 'supplier', from: '2026-07-01', to: '2026-09-30', partner: null, number: null, drafts: false }

// Supplier ledger as Odoo keeps it: bills negative (payables), payments to the supplier positive.
const ledger: LedgerResult = {
  opening: [
    { partner_id: 1, partner: 'Fontana', currency: 'USD', amount: -500 },
    { partner_id: 1, partner: 'Fontana', currency: 'EUR', amount: -200 },
  ],
  lines: [
    line({ date: '2026-07-05', amount: -1000, kind: 'bill', number: 'BILL/2026/0001', reference: 'FON-881', due_date: '2026-07-20' }),
    line({ date: '2026-07-10', amount: 800, kind: 'payment', number: 'BNK1/2026/0007', reference: 'Payment to Fontana' }),
    line({ date: '2026-08-01', amount: -300, kind: 'bill', number: 'BILL/2026/0002', reference: 'FON-902', due_date: '2026-12-01' }),
    line({ date: '2026-08-03', amount: 50, kind: 'refund', number: 'RBILL/2026/0001', reference: 'Claim credit' }),
    line({ date: '2026-08-04', amount: -120, kind: 'bill', currency: 'EUR', number: 'BILL/2026/0003', reference: 'FON-EU-1', due_date: '2026-08-20' }),
    line({ date: '2026-08-05', amount: -999, kind: 'bill', partner_id: 2, partner: 'Kibo Roses Ltd', number: 'BILL/2026/0004', due_date: '2026-08-20' }),
  ],
}

describe('statements of account', () => {
  const s = buildStatement(ledger, filters, '2026-10-08')
  const usd = s.accounts.find((a) => a.title === 'Fontana (USD)')!

  it('one account per supplier and currency', () => {
    expect(s.accounts.map((a) => a.title)).toEqual(['Fontana (EUR)', 'Fontana (USD)', 'Kibo Roses Ltd (USD)'])
  })

  it('runs the balance from the balance brought forward, with payments and refunds as their own lines', () => {
    expect(usd.opening).toBe(500)
    expect(usd.rows.map((r) => [r.number, r.charge, r.credit, r.balance])).toEqual([
      ['BILL/2026/0001', 1000, 0, 1500],
      ['BNK1/2026/0007', 0, 800, 700],
      ['BILL/2026/0002', 300, 0, 1000],
      ['RBILL/2026/0001', 0, 50, 950],
    ])
    expect([usd.charges, usd.credits, usd.closing]).toEqual([1300, 850, 950])
    expect(usd.rows[0]).toMatchObject({ reference: 'FON-881', due_date: '2026-07-20' })
  })

  it('overdue: what is past due and not yet paid, oldest first', () => {
    // 500 brought forward and the 1000 bill are due; 850 paid covers the 500 and 350 of the bill; 650 of it is overdue.
    expect(usd.overdue).toBe(650)
    expect(s.accounts.find((a) => a.title === 'Fontana (EUR)')!.overdue).toBe(320)
  })

  it('totals per currency, never across currencies', () => {
    expect(s.totals).toEqual([
      { currency: 'EUR', accounts: 1, opening: 200, charges: 120, credits: 0, closing: 320, overdue: 320 },
      { currency: 'USD', accounts: 2, opening: 500, charges: 2299, credits: 850, closing: 1949, overdue: 1649 },
    ])
  })

  it('a number search lists matching lines only, keeping their true balance', () => {
    const found = buildStatement(ledger, { ...filters, number: 'fon-902' }, '2026-10-08')
    expect(found.accounts.map((a) => a.title)).toEqual(['Fontana (USD)'])
    expect(found.accounts[0]!.rows).toHaveLength(1)
    expect(found.accounts[0]!.rows[0]!.balance).toBe(1000)
    expect(found.accounts[0]!.closing).toBe(950)
  })

  it('buyer statements: invoices raise what the buyer owes, payments lower it', () => {
    const b = buildStatement(
      { opening: [], lines: [line({ date: '2026-08-01', amount: 400, kind: 'invoice', partner: 'Bloem Handel BV' }), line({ date: '2026-08-09', amount: -150, kind: 'payment', partner: 'Bloem Handel BV' })] },
      { ...filters, side: 'buyer' },
      '2026-10-08',
    )
    expect(b.accounts[0]!.rows.map((r) => r.balance)).toEqual([400, 250])
  })

  it('demo ledger: Fontana has a USD and a EUR account, and paid bills reduce the balance', () => {
    const d = buildStatement(demoLedger({ side: 'supplier', from: '2026-01-01', to: '2026-10-08', partner: 'fontana', drafts: true }, new Date('2026-10-08T12:00:00Z')), { ...filters, from: '2026-01-01', to: '2026-10-08' }, '2026-10-08')
    expect(d.accounts.map((a) => a.title)).toEqual(['Fontana (EUR)', 'Fontana (USD)'])
    for (const a of d.accounts) {
      expect(a.credits).toBeGreaterThan(0)
      expect(a.closing).toBeCloseTo(a.opening + a.charges - a.credits, 2)
    }
  })

  it('Excel: summary, then each account with brought forward and closing lines', () => {
    const { data } = buildStatementSheet(s, new Date('2026-10-08T10:00:00Z'))
    const texts = data.map((r) => r.map((c) => (c && typeof c === 'object' && 'value' in c ? String(c.value) : '')).join('|'))
    expect(texts.some((t) => t.startsWith('Fontana (USD)'))).toBe(true)
    expect(texts.filter((t) => t.includes('Balance brought forward'))).toHaveLength(3)
    expect(texts.some((t) => t.startsWith('Closing balance') && t.endsWith('|1300|850|950'))).toBe(true)
  })

  it('PDF: pages break with the account heading repeated, and unsupported letters do not fail', async () => {
    const many: LedgerResult = { opening: [], lines: Array.from({ length: 120 }, (_, i) => line({ date: '2026-08-01', amount: -10, kind: 'bill', partner: 'Pacific Floral 日本 GK' })).concat(ledger.lines) }
    const bytes = await statementPdf(buildStatement(many, filters, '2026-10-08'))
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(2)
    expect(doc.getTitle()).toBe('Supplier statements of account')
  })
})
