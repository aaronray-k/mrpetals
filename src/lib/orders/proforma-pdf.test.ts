import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { PackingListRow } from './api'
import { proformaPdf, proformaPdfName } from './proforma-pdf'

const row = (i: number, farm: string): PackingListRow => ({
  order_id: 'o', order_number: 'CFLPFJ0089', po_number: 'PO-1', farm_name: farm, line_no: i, notes: i === 1 ? 'Sleeved' : null,
  margin_per_stem: 0.08, stems_per_box: 300, grower_price_per_stem: 0.3, product_code: `P${i}`, flower_type: 'Rose', variety: `Variety ${i}`,
  colour: 'Red', stem_length_cm: 60, boxes: 2, stems: 600, box_numbers: [i * 2 - 1, i * 2],
})
const input = (rows: PackingListRow[]) => ({
  order: { order_number: 'CFLPFJ0089', currency: 'USD', farm_delivery_date: '2026-10-09', incoterm: 'FOB' },
  buyer: { id: 'b', customer_code: 'PFJ', company_name: 'Pacific Floral Japan GK', incoterm: 'FOB', currency: 'USD', country: 'Japan', city: 'Tokyo', delivery_address: '4-8-39 Minamimachi', destination_airport: 'NRT' },
  shipment: { id: 's', shipment_ref: 'SHP-1', mawb: '176-61541003', status: 'closed' as const, flight_no: 'EK 720', flight_date: '2026-10-10', origin_airport: 'NBO', destination_airport: 'NRT', closed_at: null, arrived_at: null },
  rows,
  charges: [{ id: 'c', order_id: 'o', description: 'Data logger', amount: 26, sort_order: 1 }],
  withPrices: true,
})

describe('proforma PDF', () => {
  it('one page for a short order; more pages, with the header repeated, for a long one', async () => {
    const short = await PDFDocument.load(await proformaPdf(input([row(1, 'Kibo Roses Ltd'), row(2, 'Naku Flowers')])))
    expect(short.getPageCount()).toBe(1)
    expect(short.getTitle()).toBe('Proforma invoice CFLPFJ0089')
    const long = await PDFDocument.load(await proformaPdf(input(Array.from({ length: 80 }, (_, i) => row(i + 1, i < 40 ? 'Kibo Roses Ltd' : 'Naku Flowers')))))
    expect(long.getPageCount()).toBeGreaterThan(1)
  })
  it('named like the Excel proforma', () => {
    expect(proformaPdfName(input([]))).toBe('Proforma_CFLPFJ0089_ON_EK_10.10.2026.pdf')
  })
})
