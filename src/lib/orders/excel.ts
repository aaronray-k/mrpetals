import type { Cell, CellObject, Row } from 'write-excel-file/browser'
import { COMPANY } from '~/lib/company'
import type { BuyerRef, OrderCharge, PackingListRow, Shipment } from './api'

export interface ProformaInput {
  order: { order_number: string; currency: string; farm_delivery_date: string | null; incoterm: string }
  buyer: BuyerRef
  shipment: Shipment | null
  rows: PackingListRow[]
  charges: OrderCharge[]
  /** true: proforma invoice with prices and margins. false: packing list without prices. */
  withPrices: boolean
}

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', KES: 'KSh ' }
const BORDER: Partial<CellObject> = { borderStyle: 'thin', borderColor: '#9CA3AF' }
const HEADER_FILL = '#EAF5EB'

const date = (iso: string | null): Cell => (iso ? { value: new Date(`${iso}T00:00:00Z`), type: Date, format: 'd mmm yyyy', align: 'left' } : null)
const text = (value: string | null | undefined, extra: Partial<CellObject> = {}): Cell => (value ? { value, type: String, ...extra } : null)

/** Farms in the order their first box appears; inside a farm, lines by first box number. */
export function sortRows(rows: PackingListRow[]): PackingListRow[] {
  const first = (r: PackingListRow) => (r.box_numbers?.length ? Math.min(...r.box_numbers) : Number.MAX_SAFE_INTEGER)
  const farmFirst = new Map<string, number>()
  for (const r of rows) farmFirst.set(r.farm_name, Math.min(farmFirst.get(r.farm_name) ?? Number.MAX_SAFE_INTEGER, first(r)))
  return [...rows].sort(
    (a, b) =>
      farmFirst.get(a.farm_name)! - farmFirst.get(b.farm_name)! ||
      a.farm_name.localeCompare(b.farm_name) ||
      first(a) - first(b) ||
      a.line_no - b.line_no,
  )
}

/**
 * The sheet as rows of cells, laid out like ConsolFlora's current proforma. Margin, unit
 * price, amount and the totals are Excel formulas, so the file can be edited like today.
 * Formulas are written without the leading "=", as the xlsx format stores them.
 */
export function buildProformaSheet(input: ProformaInput) {
  const { order, buyer, shipment, withPrices } = input
  const sym = SYMBOL[order.currency] ?? `${order.currency} `
  const price = `"${sym}"#,##0.000`
  const money = `"${sym}"#,##0.00`
  const lastCol = withPrices ? 14 : 9 // N or I
  const notesCol = lastCol + 1
  const data: Row[] = []
  const row = (cells: Record<number, Cell>, height?: number): Row => {
    const r: Row = Array.from({ length: notesCol }, (_, i) => cells[i + 1] ?? null)
    if (height && r[0] && typeof r[0] === 'object' && !(r[0] instanceof Date)) (r[0] as CellObject).height = height
    return r
  }
  const right = (label: string, value: Cell): Record<number, Cell> => ({ [lastCol - 1]: text(label, { fontWeight: 'bold' }), [lastCol]: value })

  // 1-7: logo (an image over these rows) and ConsolFlora's address.
  data.push(row({}), row({ [lastCol - 1]: text(COMPANY.name, { fontWeight: 'bold' }) }))
  for (const line of COMPANY.addressLines) data.push(row({ [lastCol - 1]: text(line) }))
  data.push(row({}), row({}))
  // 8: title
  data.push(
    row({
      1: { value: withPrices ? 'PROFORMA INVOICE' : 'PACKING LIST', type: String, fontWeight: 'bold', fontSize: 14, align: 'center', columnSpan: lastCol },
    }),
  )
  // 9-14: who it's for, and the shipment
  const address = [buyer.company_name, buyer.delivery_address, buyer.city, buyer.country].filter(Boolean) as string[]
  data.push(row({ 1: text('INVOICE TO:', { fontWeight: 'bold' }), 3: text('SHIP TO', { fontWeight: 'bold' }), ...right('Invoice No.', text(order.order_number)) }))
  const meta: [string, Cell][] = [
    ['Delivery Date', date(order.farm_delivery_date)],
    ['Shipment Date', date(shipment?.flight_date ?? null)],
    ['FLIGHT', text(shipment?.flight_no)],
    ['MAWB', text(shipment?.mawb)],
    ['Incoterm', text(order.incoterm)],
  ]
  for (let i = 0; i < Math.max(address.length, meta.length); i++) {
    data.push(row({ 1: text(address[i]), 3: text(address[i]), ...(meta[i] ? right(meta[i]![0], meta[i]![1]) : {}) }))
  }

  // Header
  const headers = ['Farm', 'Type', 'Box Number', 'Variety Name', 'Colour', 'Length', 'Boxes', 'Pack Rate', 'Stems']
  if (withPrices) headers.push('Grower Price', 'Consolflora Margin /stem', 'Consolflora Margin', 'Unit Price', 'Amount')
  headers.push('Notes')
  data.push(headers.map((h) => ({ value: h, type: String, fontWeight: 'bold', backgroundColor: HEADER_FILL, wrap: true, alignVertical: 'center', ...BORDER })))

  // Lines, grouped by farm (the farm name spans its block, like the paper version)
  const sorted = sortRows(input.rows)
  const firstLine = data.length + 1
  sorted.forEach((r, i) => {
    const excelRow = data.length + 1
    const blockSize = i === 0 || sorted[i - 1]!.farm_name !== r.farm_name ? sorted.slice(i).findIndex((x) => x.farm_name !== r.farm_name) : 0
    const span = blockSize === -1 ? sorted.length - i : blockSize
    const cells: Cell[] = [
      span ? { value: r.farm_name, type: String, rowSpan: span, alignVertical: 'top', fontWeight: 'bold', ...BORDER } : null,
      { value: r.flower_type, type: String, ...BORDER },
      { value: (r.box_numbers ?? []).join(', '), type: String, wrap: true, ...BORDER },
      { value: r.variety, type: String, ...BORDER },
      text(r.colour, BORDER) ?? { value: '', type: String, ...BORDER },
      { value: `${r.stem_length_cm}cm`, type: String, ...BORDER },
      { value: r.boxes, type: Number, ...BORDER },
      { value: r.stems_per_box, type: Number, ...BORDER },
      { value: r.stems, type: Number, ...BORDER },
    ]
    if (withPrices) {
      cells.push(
        r.grower_price_per_stem == null ? { value: '', type: String, ...BORDER } : { value: r.grower_price_per_stem, type: Number, format: price, ...BORDER },
        r.margin_per_stem == null ? { value: '', type: String, ...BORDER } : { value: r.margin_per_stem, type: Number, format: price, ...BORDER },
        { value: `I${excelRow}*K${excelRow}`, type: 'Formula', format: money, ...BORDER },
        { value: `J${excelRow}+K${excelRow}`, type: 'Formula', format: price, ...BORDER },
        { value: `I${excelRow}*M${excelRow}`, type: 'Formula', format: money, ...BORDER },
      )
    }
    cells.push(text(r.notes))
    data.push(cells)
  })
  const lastLine = data.length

  // Totals
  const totalRow = data.length + 1
  const sum = (col: string, fmt?: string): Cell =>
    sorted.length ? { value: `SUM(${col}${firstLine}:${col}${lastLine})`, type: 'Formula', fontWeight: 'bold', ...(fmt ? { format: fmt } : {}) } : { value: 0, type: Number }
  const totals: Record<number, Cell> = { 1: text('Total', { fontWeight: 'bold' }), 7: sum('G'), 9: sum('I') }
  if (withPrices) Object.assign(totals, { 12: sum('L', money), 14: sum('N', money) })
  data.push(row(totals))

  if (withPrices) {
    const charges = [...input.charges].sort((a, b) => a.sort_order - b.sort_order)
    const firstCharge = data.length + 1
    charges.forEach((c, i) => {
      data.push(
        row({
          ...(i === 0 ? { 3: { value: 'Other costs', type: String, fontWeight: 'bold', rowSpan: charges.length } } : {}),
          8: text(c.description),
          14: { value: c.amount, type: Number, format: money },
        }),
      )
    })
    const lastCharge = data.length
    const grand = data.length + 1
    data.push(
      row({
        8: text('Total', { fontWeight: 'bold' }),
        14: { value: charges.length ? `N${totalRow}+SUM(N${firstCharge}:N${lastCharge})` : `N${totalRow}`, type: 'Formula', format: money, fontWeight: 'bold' },
      }),
      row({}),
      row({ 8: text('Grand Total', { fontWeight: 'bold' }), 14: { value: `N${grand}`, type: 'Formula', format: money, fontWeight: 'bold' } }),
    )
  }

  data.push(row({}))
  data.push(
    row({
      1: { value: 'Additional Declaration', type: String, fontWeight: 'bold', columnSpan: 3, alignVertical: 'top' },
      4: { value: COMPANY.originDeclaration, type: String, wrap: true, columnSpan: lastCol - 3, alignVertical: 'top', height: 48 },
    }),
  )

  // The column before the last holds "Invoice No.", "Shipment Date"...: keep it wide enough.
  const widths = withPrices ? [26, 14.7, 25.6, 24.3, 14.2, 8.5, 7.1, 10, 9, 13, 13, 14, 15, 14] : [26, 14.7, 25.6, 24.3, 14.2, 8.5, 7.1, 15, 14]
  widths.push(16)
  return { data, columns: widths.map((width) => ({ width })) }
}

/** "Proforma_CFLPFJ0041_ON_EK_03.08.2026.xlsx", like the files ConsolFlora sends today. */
export function proformaFileName(input: ProformaInput) {
  const airline = (input.shipment?.flight_no ?? '').trim().split(/\s+/)[0] || 'TBA'
  const d = input.shipment?.flight_date
  const when = d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : 'undated'
  return `${input.withPrices ? 'Proforma' : 'PackingList'}_${input.order.order_number}_ON_${airline}_${when}.xlsx`
}

/**
 * Print setup: A4 landscape, one page wide (as many pages tall as needed), so long packing lists
 * stay readable. write-excel-file has no option for this, so it is added to the sheet XML.
 */
export const fitToPageWidth = {
  files: {
    transform: {
      'xl/worksheets/sheet{id}.xml': {
        transform: (xml: string) => {
          let out = xml
          if (!out.includes('<sheetPr')) out = out.replace(/<worksheet\b[^>]*>/, (open) => `${open}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`)
          if (!out.includes('<pageSetup')) {
            const setup =
              '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
              '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
            out = out.includes('<drawing') ? out.replace('<drawing', `${setup}<drawing`) : out.replace('</worksheet>', `${setup}</worksheet>`)
          }
          return out
        },
      },
    },
  },
}

/** Builds the workbook in the browser and downloads it. */
export async function downloadProforma(input: ProformaInput) {
  const [{ default: writeXlsxFile }, logo] = await Promise.all([
    import('write-excel-file/browser'),
    fetch('/labels/consolflora-logo-full.png').then((r) => r.arrayBuffer()),
  ])
  const { data, columns } = buildProformaSheet(input)
  await writeXlsxFile(
    data,
    {
      sheet: input.withPrices ? 'Proforma' : 'Packing list',
      columns,
      // 1200 x 463 px artwork shown about 300 px wide.
      images: [{ content: logo, contentType: 'image/png', width: 1200, height: 463, dpi: 384, anchor: { row: 1, column: 1 }, title: 'Consolflora' }],
    },
    { features: [fitToPageWidth] },
  ).toFile(proformaFileName(input))
}
