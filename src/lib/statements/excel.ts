import type { Cell, CellObject, Row } from 'write-excel-file/browser'
import { COMPANY } from '~/lib/company'
import { fitToPageWidth } from '~/lib/orders/excel'
import { KIND_LABEL, SIDE_LABEL, filtersLabel, statementFileName, type Statement } from './statement'

const COLS = 8
const MONEY = '#,##0.00;-#,##0.00;-'
const BALANCE = '#,##0.00'
const BORDER: Partial<CellObject> = { borderStyle: 'thin', borderColor: '#9CA3AF' }
const HEAD: Partial<CellObject> = { fontWeight: 'bold', backgroundColor: '#EAF5EB', ...BORDER }

const text = (value: string | null | undefined, extra: Partial<CellObject> = {}): Cell => (value ? { value, type: String, ...extra } : extra.borderStyle ? { value: '', type: String, ...extra } : null)
const num = (value: number, extra: Partial<CellObject> = {}): Cell => ({ value, type: Number, format: MONEY, ...BORDER, ...extra })
const date = (iso: string | null, extra: Partial<CellObject> = {}): Cell =>
  iso ? { value: new Date(`${iso}T00:00:00Z`), type: Date, format: 'd mmm yyyy', align: 'left', ...BORDER, ...extra } : text('', { ...BORDER, ...extra })
const pad = (cells: Cell[]): Row => [...cells, ...Array<Cell>(Math.max(0, COLS - cells.length)).fill(null)]

/** One sheet: the summary per currency, then each supplier (or buyer) and currency with its running balance. */
export function buildStatementSheet(s: Statement, generatedAt = new Date()) {
  const side = SIDE_LABEL[s.filters.side]
  const data: Row[] = []
  data.push(pad([text(`${COMPANY.name}: ${side.title}`, { fontWeight: 'bold', fontSize: 14, columnSpan: COLS })]))
  data.push(pad([text(filtersLabel(s.filters), { columnSpan: COLS })]))
  data.push(pad([text(`From Odoo, ${generatedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. Balance: ${side.balance.toLowerCase()}.`, { columnSpan: COLS })]))
  data.push(pad([]))
  data.push(pad([text('Summary', { fontWeight: 'bold', columnSpan: COLS })]))
  data.push(pad(['Currency', 'Accounts', 'Brought forward', s.filters.side === 'supplier' ? 'Bills' : 'Invoices', 'Paid / credited', 'Balance', 'Overdue'].map((h) => text(h, HEAD))))
  for (const t of s.totals) data.push(pad([text(t.currency, BORDER), { value: t.accounts, type: Number, ...BORDER }, num(t.opening), num(t.charges), num(t.credits), num(t.closing, { fontWeight: 'bold', format: BALANCE }), num(t.overdue)]))
  if (!s.totals.length) data.push(pad([text('Nothing for these filters.', { columnSpan: COLS })]))

  for (const a of s.accounts) {
    data.push(pad([]))
    data.push(pad([text(a.title, { fontWeight: 'bold', fontSize: 12, columnSpan: COLS })]))
    data.push(pad(['Date', 'Type', s.filters.side === 'supplier' ? 'Bill no.' : 'Invoice no.', 'Reference', 'Due date', `Amount (${a.currency})`, `Paid / credited (${a.currency})`, `Balance (${a.currency})`].map((h) => text(h, { ...HEAD, wrap: true }))))
    data.push(pad([date(s.filters.from), text('Balance brought forward', { ...BORDER, columnSpan: 4 }), null, null, null, text('', BORDER), text('', BORDER), num(a.opening, { format: BALANCE })]))
    for (const r of a.rows)
      data.push(pad([date(r.date), text(KIND_LABEL[r.kind] + (r.draft ? ' (draft)' : ''), BORDER), text(r.number, BORDER), text(r.reference ?? '', { ...BORDER, wrap: true }), date(r.due_date), num(r.charge), num(r.credit), num(r.balance, { format: BALANCE })]))
    data.push(pad([text('Closing balance', { ...BORDER, fontWeight: 'bold', columnSpan: 5 }), null, null, null, null, num(a.charges, { fontWeight: 'bold' }), num(a.credits, { fontWeight: 'bold' }), num(a.closing, { fontWeight: 'bold', format: BALANCE })]))
    if (a.overdue > 0) data.push(pad([text(`Of which overdue: ${a.overdue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${a.currency}`, { columnSpan: COLS, fontWeight: 'bold' })]))
  }
  return { data, columns: [12, 14, 20, 32, 12, 16, 18, 16].map((width) => ({ width })) }
}

export async function downloadStatementExcel(s: Statement) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const { data, columns } = buildStatementSheet(s)
  await writeXlsxFile(data, { sheet: 'Statement', columns }, { features: [fitToPageWidth] }).toFile(statementFileName(s.filters, 'xlsx'))
}
