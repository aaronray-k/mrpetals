import type { LedgerLine, LedgerResult, LedgerSide } from '~/server/odoo/client'

/**
 * A cumulative statement of account per supplier (or buyer) and currency, from Odoo's ledger.
 * A supplier or buyer with more than one currency has one account per currency, e.g. "Fontana (USD)" and
 * "Fontana (EUR)". The balance runs line by line from the balance brought forward; payments, refunds and
 * credit notes are their own lines, so the closing balance is what is still to be paid.
 */
export interface StatementFilters {
  side: LedgerSide
  from: string | null
  to: string
  partner: string | null
  /** Bill, invoice or payment number, or reference. Only matching lines are listed; balances stay true. */
  number: string | null
  drafts: boolean
}
export interface StatementRow {
  date: string
  kind: LedgerLine['kind']
  number: string
  reference: string | null
  due_date: string | null
  /** Bills (supplier) or invoices (buyer): what increases the balance. */
  charge: number
  /** Payments, refunds and credit notes: what reduces it. */
  credit: number
  balance: number
  draft: boolean
}
export interface StatementAccount {
  key: string
  partner: string
  currency: string
  /** e.g. "Fontana (USD)" */
  title: string
  opening: number
  rows: StatementRow[]
  charges: number
  credits: number
  closing: number
  /** Of the closing balance, how much is past its due date (bills or invoices not yet covered by payments, oldest first). */
  overdue: number
}
export interface Statement {
  filters: StatementFilters
  accounts: StatementAccount[]
  /** Per currency: what is owed in total across the accounts listed. */
  totals: { currency: string; accounts: number; opening: number; charges: number; credits: number; closing: number; overdue: number }[]
}

export const KIND_LABEL: Record<LedgerLine['kind'], string> = {
  bill: 'Bill',
  refund: 'Refund',
  invoice: 'Invoice',
  credit_note: 'Credit note',
  payment: 'Payment',
  entry: 'Journal entry',
}
export const SIDE_LABEL: Record<LedgerSide, { title: string; who: string; balance: string }> = {
  supplier: { title: 'Supplier statements of account', who: 'Supplier', balance: 'We owe' },
  buyer: { title: 'Buyer statements of account', who: 'Buyer', balance: 'They owe' },
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function buildStatement(ledger: LedgerResult, filters: StatementFilters, today = new Date().toISOString().slice(0, 10)): Statement {
  // Supplier ledgers are payables (Odoo keeps a bill as a negative amount): flip so "what we owe" is positive.
  const sign = filters.side === 'supplier' ? -1 : 1
  const accounts = new Map<string, StatementAccount>()
  const account = (partner_id: number, partner: string, currency: string) => {
    const key = `${partner_id}|${currency}`
    let a = accounts.get(key)
    if (!a) {
      a = { key, partner, currency, title: `${partner} (${currency})`, opening: 0, rows: [], charges: 0, credits: 0, closing: 0, overdue: 0 }
      accounts.set(key, a)
    }
    return a
  }
  for (const o of ledger.opening) account(o.partner_id, o.partner, o.currency).opening = r2(sign * o.amount)
  const needle = filters.number?.trim().toLowerCase() || null
  const matches = (l: LedgerLine) => !needle || l.number.toLowerCase().includes(needle) || (l.reference ?? '').toLowerCase().includes(needle)
  const lines = [...ledger.lines].sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id)
  const running = new Map<string, number>()
  // For "overdue": amounts charged and not yet covered by payments or credits, oldest first, plus any credit in hand.
  const queues = new Map<string, { open: { due: string; left: number }[]; spare: number }>()
  const queueOf = (a: StatementAccount) => {
    let q = queues.get(a.key)
    if (!q) {
      q = { open: a.opening > 0 ? [{ due: filters.from ?? '0000-01-01', left: a.opening }] : [], spare: a.opening < 0 ? -a.opening : 0 }
      queues.set(a.key, q)
    }
    return q
  }
  for (const l of lines) {
    const a = account(l.partner_id, l.partner, l.currency)
    const v = sign * l.amount
    const balance = r2((running.get(a.key) ?? a.opening) + v)
    running.set(a.key, balance)
    const charge = v > 0 ? r2(v) : 0
    const credit = v < 0 ? r2(-v) : 0
    a.charges = r2(a.charges + charge)
    a.credits = r2(a.credits + credit)
    const q = queueOf(a)
    if (charge) {
      const used = Math.min(q.spare, charge)
      q.spare = r2(q.spare - used)
      if (charge - used > 0) q.open.push({ due: l.due_date ?? l.date, left: r2(charge - used) })
    }
    let c = credit
    while (c > 0 && q.open.length) {
      const take = Math.min(c, q.open[0]!.left)
      q.open[0]!.left = r2(q.open[0]!.left - take)
      c = r2(c - take)
      if (q.open[0]!.left <= 0) q.open.shift()
    }
    q.spare = r2(q.spare + c)
    // With a number search, only matching lines are listed; the balance on each is still the true running balance.
    if (matches(l)) a.rows.push({ date: l.date, kind: l.kind, number: l.number === '/' ? 'Draft' : l.number, reference: l.reference, due_date: l.due_date, charge, credit, balance, draft: l.draft })
  }
  for (const a of accounts.values()) {
    a.closing = r2(running.get(a.key) ?? a.opening)
    const q = queueOf(a)
    a.overdue = r2(Math.max(0, q.open.filter((x) => x.due < today).reduce((s, x) => s + x.left, 0)))
  }
  const list = [...accounts.values()]
    .filter((a) => (needle ? a.rows.length > 0 : a.rows.length > 0 || a.opening !== 0))
    .sort((x, y) => x.partner.localeCompare(y.partner) || x.currency.localeCompare(y.currency))
  const totals = new Map<string, Statement['totals'][number]>()
  for (const a of list) {
    const t = totals.get(a.currency) ?? { currency: a.currency, accounts: 0, opening: 0, charges: 0, credits: 0, closing: 0, overdue: 0 }
    t.accounts++
    t.opening = r2(t.opening + a.opening)
    t.charges = r2(t.charges + a.charges)
    t.credits = r2(t.credits + a.credits)
    t.closing = r2(t.closing + a.closing)
    t.overdue = r2(t.overdue + a.overdue)
    totals.set(a.currency, t)
  }
  return { filters, accounts: list, totals: [...totals.values()].sort((x, y) => x.currency.localeCompare(y.currency)) }
}

/** "1 Jan 2026 – 8 Oct 2026", "Up to 8 Oct 2026" */
export function periodLabel(f: Pick<StatementFilters, 'from' | 'to'>) {
  const d = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return f.from ? `${d(f.from)} – ${d(f.to)}` : `Up to ${d(f.to)}`
}
export function filtersLabel(f: StatementFilters) {
  return [periodLabel(f), f.partner && `${SIDE_LABEL[f.side].who}: "${f.partner}"`, f.number && `Number or reference: "${f.number}"`, f.drafts ? 'Drafts included' : 'Confirmed only']
    .filter(Boolean)
    .join(' · ')
}
export function statementFileName(f: StatementFilters, ext: 'pdf' | 'xlsx') {
  return `${f.side === 'supplier' ? 'Supplier' : 'Buyer'} statements ${f.from ?? 'start'} to ${f.to}${f.partner ? ` ${f.partner.replace(/[^\w -]/g, '')}` : ''}.${ext}`
}
