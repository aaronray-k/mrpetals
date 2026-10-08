import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { COMPANY } from '~/lib/company'
import { KIND_LABEL, SIDE_LABEL, filtersLabel, statementFileName, type Statement, type StatementAccount } from './statement'

// A4 landscape, in points.
const W = 842
const H = 595
const M = 36
const SIZE = 8.5
const ROW = 14
const INK = rgb(0.1, 0.12, 0.1)
const MUTED = rgb(0.4, 0.42, 0.4)
const RULE = rgb(0.75, 0.77, 0.75)
const HEAD_FILL = rgb(0.918, 0.961, 0.922)
const COLS: { w: number; right?: boolean }[] = [{ w: 62 }, { w: 74 }, { w: 112 }, { w: 212 }, { w: 62 }, { w: 82, right: true }, { w: 84, right: true }, { w: 82, right: true }]

const amount = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Amount columns show '-' for nothing; balances always show their figure. */
const money = (n: number) => (n === 0 ? '-' : amount(n))
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')

/** The statement as a PDF: a summary per currency, then each account with its running balance. Returns the bytes. */
export async function statementPdf(s: Statement, generatedAt = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(SIDE_LABEL[s.filters.side].title)
  doc.setAuthor(COMPANY.name)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  // The standard PDF fonts only cover Western European letters; anything else prints as "?".
  const safe = (font: PDFFont, t: string) =>
    [...t]
      .map((ch) => {
        try {
          font.encodeText(ch)
          return ch
        } catch {
          return '?'
        }
      })
      .join('')
  const fit = (font: PDFFont, t: string, width: number, size = SIZE) => {
    let out = safe(font, t)
    if (font.widthOfTextAtSize(out, size) <= width) return out
    while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > width) out = out.slice(0, -1)
    return `${out}…`
  }

  let page: PDFPage = doc.addPage([W, H])
  let y = H - M
  const write = (t: string, x: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; width?: number; right?: boolean } = {}) => {
    const font = opts.font ?? regular
    const size = opts.size ?? SIZE
    const str = opts.width ? fit(font, t, opts.width, size) : safe(font, t)
    const dx = opts.right && opts.width ? opts.width - font.widthOfTextAtSize(str, size) : 0
    page.drawText(str, { x: x + dx, y, size, font, color: opts.color ?? INK })
  }
  const cells = (values: string[], opts: { font?: PDFFont; fill?: boolean } = {}) => {
    if (opts.fill) page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: ROW, color: HEAD_FILL })
    let x = M
    COLS.forEach((c, i) => {
      write(values[i] ?? '', x + 3, { font: opts.font, width: c.w - 6, right: c.right })
      x += c.w
    })
    page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.4, color: RULE })
    y -= ROW
  }
  const header = (a: StatementAccount) =>
    cells(['Date', 'Type', s.filters.side === 'supplier' ? 'Bill no.' : 'Invoice no.', 'Reference', 'Due date', `Amount ${a.currency}`, `Paid/credited ${a.currency}`, `Balance ${a.currency}`], { font: bold, fill: true })
  const newPage = () => {
    page = doc.addPage([W, H])
    y = H - M
  }
  /** Room for `rows` more rows on this page, or a new page (repeating the account's heading and columns). */
  const room = (rows: number, a?: StatementAccount) => {
    if (y - rows * ROW >= M + 20) return
    newPage()
    if (a) {
      write(`${a.title}, continued`, M, { font: bold, size: 10 })
      y -= ROW + 2
      header(a)
    }
  }

  // Title and filters.
  write(COMPANY.name, M, { font: bold, size: 9, color: MUTED })
  y -= 18
  write(SIDE_LABEL[s.filters.side].title, M, { font: bold, size: 16 })
  y -= 16
  write(filtersLabel(s.filters), M, { color: MUTED, size: 9 })
  y -= 12
  write(`From Odoo, ${generatedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. Balance = ${SIDE_LABEL[s.filters.side].balance.toLowerCase()}.`, M, { color: MUTED, size: 9 })
  y -= 22

  // Summary per currency (never added across currencies).
  write('Summary', M, { font: bold, size: 11 })
  y -= ROW + 2
  cells(['Currency', 'Accounts', '', '', 'Brought fwd', s.filters.side === 'supplier' ? 'Bills' : 'Invoices', 'Paid/credited', 'Balance'], { font: bold, fill: true })
  for (const t of s.totals) cells([t.currency, String(t.accounts), '', t.overdue ? `Overdue: ${money(t.overdue)}` : '', money(t.opening), money(t.charges), money(t.credits), amount(t.closing)], { font: regular })
  if (!s.totals.length) cells(['Nothing for these filters.'])
  y -= 10

  for (const a of s.accounts) {
    room(5)
    write(a.title, M, { font: bold, size: 11 })
    y -= ROW + 2
    header(a)
    cells([day(s.filters.from), 'Brought forward', '', '', '', '', '', amount(a.opening)])
    for (const r of a.rows) {
      room(1, a)
      cells([day(r.date), KIND_LABEL[r.kind] + (r.draft ? ' (draft)' : ''), r.number, r.reference ?? '', day(r.due_date), money(r.charge), money(r.credit), amount(r.balance)])
    }
    room(2, a)
    cells(['Closing balance', '', '', a.overdue > 0 ? `Of which overdue: ${money(a.overdue)} ${a.currency}` : '', '', money(a.charges), money(a.credits), amount(a.closing)], { font: bold })
    y -= 12
  }

  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const t = `${COMPANY.name} · ${SIDE_LABEL[s.filters.side].title} · Page ${i + 1} of ${pages.length}`
    p.drawText(t, { x: M, y: M - 18, size: 7.5, font: regular, color: MUTED })
  })
  return doc.save()
}

export async function downloadStatementPdf(s: Statement) {
  const bytes = await statementPdf(s)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = statementFileName(s.filters, 'pdf')
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
