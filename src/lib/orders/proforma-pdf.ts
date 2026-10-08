import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { COMPANY } from '~/lib/company'
import { sortRows, type ProformaInput } from './excel'

// A4 landscape, in points.
const W = 842
const H = 595
const M = 36
const SIZE = 7
const LINE = 8.5
const INK = rgb(0.1, 0.12, 0.1)
const MUTED = rgb(0.4, 0.42, 0.4)
const RULE = rgb(0.62, 0.64, 0.62)
const HEAD_FILL = rgb(0.918, 0.961, 0.922)
const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', KES: 'KSh ' }

type Col = { head: string; w: number; right?: boolean; wrap?: boolean }
const COLS: Col[] = [
  { head: 'Farm', w: 80, wrap: true },
  { head: 'Type', w: 50, wrap: true },
  { head: 'Box Number', w: 70, wrap: true },
  { head: 'Variety Name', w: 75, wrap: true },
  { head: 'Colour', w: 45, wrap: true },
  { head: 'Length', w: 35, right: true },
  { head: 'Boxes', w: 30, right: true },
  { head: 'Pack Rate', w: 32, right: true },
  { head: 'Stems', w: 38, right: true },
  { head: 'Grower Price', w: 45, right: true },
  { head: 'Consolflora Margin /stem', w: 45, right: true },
  { head: 'Consolflora Margin', w: 50, right: true },
  { head: 'Unit Price', w: 48, right: true },
  { head: 'Amount', w: 58, right: true },
  { head: 'Notes', w: 69, wrap: true },
]

/**
 * The proforma invoice as a PDF, laid out like ConsolFlora's Excel proforma (the same columns, totals, other
 * costs and declaration). `logo` is the PNG of ConsolFlora's logo, if available.
 */
export async function proformaPdf(input: ProformaInput, logo?: Uint8Array | null): Promise<Uint8Array> {
  const { order, buyer, shipment } = input
  const sym = SYMBOL[order.currency] ?? `${order.currency} `
  const money = (n: number) => `${n < 0 ? '-' : ''}${sym}${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const price = (n: number | null) => (n == null ? '' : `${sym}${n.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`)
  const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')

  const doc = await PDFDocument.create()
  doc.setTitle(`Proforma invoice ${order.order_number}`)
  doc.setAuthor(COMPANY.name)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const image = logo ? await doc.embedPng(logo).catch(() => null) : null
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
  /** Splits text into lines that fit `width`. */
  const wrap = (font: PDFFont, t: string, width: number, size = SIZE) => {
    const out: string[] = []
    for (const para of safe(font, t).split('\n')) {
      let line = ''
      for (const word of para.split(/(?<=[\s,])/)) {
        if (font.widthOfTextAtSize(line + word, size) <= width || !line) line += word
        else {
          out.push(line.trimEnd())
          line = word.trimStart()
        }
      }
      out.push(line.trimEnd())
    }
    return out
  }

  let page: PDFPage = doc.addPage([W, H])
  let y = H - M
  const write = (t: string, x: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; width?: number; right?: boolean } = {}) => {
    const font = o.font ?? regular
    const size = o.size ?? SIZE
    const s = safe(font, t)
    const dx = o.right && o.width ? o.width - font.widthOfTextAtSize(s, size) : 0
    page.drawText(s, { x: x + dx, y, size, font, color: o.color ?? INK })
  }

  /** One table row; cells wrap where the column allows. Returns its height. */
  const row = (cells: string[], o: { font?: PDFFont; fill?: boolean; border?: boolean } = {}) => {
    const font = o.font ?? regular
    const lines = COLS.map((c, i) => (c.wrap || o.fill ? wrap(font, cells[i] ?? '', c.w - 4) : [cells[i] ?? '']))
    const h = Math.max(...lines.map((l) => l.length)) * LINE + 4
    if (y - h < M + 14) newPage(true)
    const top = y
    if (o.fill) page.drawRectangle({ x: M, y: top - h, width: W - 2 * M, height: h, color: HEAD_FILL })
    let x = M
    COLS.forEach((c, i) => {
      lines[i]!.forEach((ln, k) => {
        y = top - 8 - k * LINE
        write(ln, x + 2, { font, width: c.w - 4, right: c.right && !o.fill })
      })
      if (o.border !== false) page.drawRectangle({ x, y: top - h, width: c.w, height: h, borderColor: RULE, borderWidth: 0.4 })
      x += c.w
    })
    y = top - h
    return h
  }
  const header = () => row(COLS.map((c) => c.head), { font: bold, fill: true })
  function newPage(withHeader: boolean) {
    page = doc.addPage([W, H])
    y = H - M
    write(`Proforma invoice ${order.order_number} (continued)`, M, { font: bold, size: 8 })
    y -= 12
    if (withHeader) header()
  }

  // Logo left, ConsolFlora's address right.
  if (image) {
    const w = 150
    page.drawImage(image, { x: M, y: y - (w * image.height) / image.width, width: w, height: (w * image.height) / image.width })
  }
  const addrX = W - M - 200
  write(COMPANY.name, addrX, { font: bold, size: 9 })
  for (const l of COMPANY.addressLines) {
    y -= 11
    write(l, addrX, { size: 8 })
  }
  y = H - M - 70
  const title = 'PROFORMA INVOICE'
  write(title, (W - bold.widthOfTextAtSize(title, 14)) / 2, { font: bold, size: 14 })
  y -= 20

  // Who it's for, and the shipment.
  const address = [buyer.company_name, buyer.delivery_address, buyer.city, buyer.country].filter(Boolean) as string[]
  const meta: [string, string][] = [
    ['Invoice No.', order.order_number],
    ['Delivery Date', day(order.farm_delivery_date)],
    ['Shipment Date', day(shipment?.flight_date)],
    ['FLIGHT', shipment?.flight_no ?? ''],
    ['MAWB', shipment?.mawb ?? ''],
    ['Incoterm', order.incoterm],
  ]
  write('INVOICE TO:', M, { font: bold, size: 8 })
  write('SHIP TO', M + 220, { font: bold, size: 8 })
  const top = y
  for (let i = 0; i < Math.max(address.length + 1, meta.length); i++) {
    y = top - i * 11
    if (i > 0 && address[i - 1]) {
      write(address[i - 1]!, M, { size: 8 })
      write(address[i - 1]!, M + 220, { size: 8 })
    }
    if (meta[i]) {
      write(meta[i]![0], W - M - 200, { font: bold, size: 8 })
      write(meta[i]![1], W - M - 110, { size: 8 })
    }
  }
  y -= 18

  // Lines, by farm, as in the Excel proforma.
  header()
  let boxes = 0
  let stems = 0
  let margin = 0
  let amount = 0
  const sorted = sortRows(input.rows)
  sorted.forEach((r, i) => {
    const unit = r.grower_price_per_stem == null && r.margin_per_stem == null ? null : (r.grower_price_per_stem ?? 0) + (r.margin_per_stem ?? 0)
    const lineMargin = r.margin_per_stem == null ? null : r.stems * r.margin_per_stem
    const lineAmount = unit == null ? null : r.stems * unit
    boxes += r.boxes
    stems += r.stems
    margin += lineMargin ?? 0
    amount += lineAmount ?? 0
    row([
      i === 0 || sorted[i - 1]!.farm_name !== r.farm_name ? r.farm_name : '',
      r.flower_type,
      (r.box_numbers ?? []).join(', '),
      r.variety,
      r.colour ?? '',
      `${r.stem_length_cm}cm`,
      String(r.boxes),
      String(r.stems_per_box),
      r.stems.toLocaleString('en-GB'),
      price(r.grower_price_per_stem),
      price(r.margin_per_stem),
      lineMargin == null ? '' : money(lineMargin),
      price(unit),
      lineAmount == null ? '' : money(lineAmount),
      r.notes ?? '',
    ])
  })
  row(['Total', '', '', '', '', '', String(boxes), '', stems.toLocaleString('en-GB'), '', '', money(margin), '', money(amount), ''], { font: bold })

  // Other costs, total and grand total.
  const charges = [...input.charges].sort((a, b) => a.sort_order - b.sort_order)
  const labelX = M + COLS.slice(0, 7).reduce((s, c) => s + c.w, 0)
  const valueW = COLS[13]!.w
  const valueX = M + COLS.slice(0, 13).reduce((s, c) => s + c.w, 0)
  const line = (label: string, value: string, b = false) => {
    if (y - 14 < M + 14) newPage(false)
    y -= 14
    write(label, labelX, { font: b ? bold : regular, size: 8 })
    write(value, valueX, { font: b ? bold : regular, size: 8, width: valueW - 2, right: true })
  }
  charges.forEach((c, i) => {
    line(c.description, money(c.amount))
    // "Other costs" heads the charges, on the first one's line (as in the Excel proforma).
    if (i === 0) write('Other costs', M + COLS[0]!.w + COLS[1]!.w, { font: bold, size: 8 })
  })
  const total = amount + charges.reduce((s, c) => s + c.amount, 0)
  line('Total', money(total), true)
  y -= 6
  line('Grand Total', money(total), true)

  // Declaration.
  y -= 22
  if (y < M + 50) newPage(false)
  write('Additional Declaration', M, { font: bold, size: 8 })
  for (const l of wrap(regular, COMPANY.originDeclaration, W - 2 * M - 140, 8)) {
    write(l, M + 140, { size: 8 })
    y -= 10
  }

  const pages = doc.getPages()
  pages.forEach((p, i) => p.drawText(safe(regular, `${COMPANY.name} · Proforma invoice ${order.order_number} · Page ${i + 1} of ${pages.length}`), { x: M, y: M - 18, size: 7, font: regular, color: MUTED }))
  return doc.save()
}

/** "Proforma_CFLPFJ0041_ON_EK_03.08.2026.pdf", like the Excel file's name. */
export function proformaPdfName(input: Pick<ProformaInput, 'order' | 'shipment'>) {
  const airline = (input.shipment?.flight_no ?? '').trim().split(/\s+/)[0] || 'TBA'
  const d = input.shipment?.flight_date
  const when = d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : 'undated'
  return `Proforma_${input.order.order_number}_ON_${airline}_${when}.pdf`
}
