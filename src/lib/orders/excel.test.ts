import { describe, expect, it } from 'vitest'
import type { CellObject } from 'write-excel-file/browser'
import type { BuyerRef, PackingListRow, Shipment } from './api'
import { buildProformaSheet, proformaFileName, sortRows, type ProformaInput } from './excel'

const line = (farm: string, variety: string, boxes: number[], extra: Partial<PackingListRow> = {}): PackingListRow => ({
  order_id: 'o',
  order_number: 'CFLPFJ0041',
  po_number: 'PO-2026-00001',
  farm_name: farm,
  line_no: 1,
  notes: null,
  margin_per_stem: 0.015,
  stems_per_box: 160,
  grower_price_per_stem: 0.32,
  product_code: 'X',
  flower_type: 'Roses',
  variety,
  colour: 'Red',
  stem_length_cm: 70,
  boxes: boxes.length,
  stems: boxes.length * 160,
  box_numbers: boxes,
  ...extra,
})

const buyer: BuyerRef = {
  id: 'b',
  customer_code: 'PFJ',
  company_name: 'Pacific Floral Japan GK',
  incoterm: 'FOB',
  currency: 'USD',
  country: 'Japan',
  city: 'Tokyo 2030031',
  delivery_address: '4-8-39 Minamimachi',
  destination_airport: 'NRT',
}
const shipment: Shipment = {
  id: 's',
  shipment_ref: 'SHP-1',
  mawb: '176-6154-0743',
  status: 'open',
  flight_no: 'EK 720',
  flight_date: '2026-08-03',
  origin_airport: 'NBO',
  destination_airport: 'NRT',
  closed_at: null,
    arrived_at: null,
}
const input = (withPrices: boolean): ProformaInput => ({
  order: { order_number: 'CFLPFJ0041', currency: 'USD', farm_delivery_date: '2026-08-01', incoterm: 'FOB' },
  buyer,
  shipment,
  rows: [
    line('Hortech', 'Ever Red', [9, 10, 11, 12, 13]),
    line('Ever Flora', 'Madam Red', [1], { stem_length_cm: 40, stems_per_box: 500, stems: 500, margin_per_stem: 0.01, grower_price_per_stem: 0.085, notes: 'Bunching by 3' }),
    line('Ever Flora', 'Kings Day', [3, 4]),
    line('Hortech', 'Revival', [35, 36, 37], { grower_price_per_stem: null }),
  ],
  charges: [
    { id: 'c1', order_id: 'o', description: 'Consolidation fee', amount: 80, sort_order: 1 },
    { id: 'c2', order_id: 'o', description: 'Data logger', amount: 26, sort_order: 2 },
  ],
  withPrices,
})

const cell = (data: ReturnType<typeof buildProformaSheet>['data'], row: number, col: number) => data[row - 1]?.[col - 1] as CellObject | null
const findRow = (data: ReturnType<typeof buildProformaSheet>['data'], value: string) =>
  data.findIndex((r) => r.some((c) => c && typeof c === 'object' && 'value' in c && c.value === value)) + 1

describe('proforma sheet', () => {
  it('puts farms in the order of their first box', () => {
    expect(sortRows(input(true).rows).map((r) => r.variety)).toEqual(['Madam Red', 'Kings Day', 'Ever Red', 'Revival'])
  })

  it('lays out the header like the current proforma', () => {
    const { data } = buildProformaSheet(input(true))
    expect(cell(data, 8, 1)).toMatchObject({ value: 'PROFORMA INVOICE', columnSpan: 14 })
    expect(cell(data, 9, 14)).toMatchObject({ value: 'CFLPFJ0041' })
    expect(cell(data, 10, 1)).toMatchObject({ value: 'Pacific Floral Japan GK' })
    expect(cell(data, 12, 14)).toMatchObject({ value: 'EK 720' })
    expect(cell(data, 13, 14)).toMatchObject({ value: '176-6154-0743' })
    const header = findRow(data, 'Box Number')
    expect(data[header - 1]!.map((c) => (c as CellObject).value)).toEqual([
      'Farm', 'Type', 'Box Number', 'Variety Name', 'Colour', 'Length', 'Boxes', 'Pack Rate', 'Stems',
      'Grower Price', 'Consolflora Margin /stem', 'Consolflora Margin', 'Unit Price', 'Amount', 'Notes',
    ])
  })

  it('spans the farm name over its lines and writes formulas for each line', () => {
    const { data } = buildProformaSheet(input(true))
    const first = findRow(data, 'Box Number') + 1
    expect(cell(data, first, 1)).toMatchObject({ value: 'Ever Flora', rowSpan: 2 })
    expect(cell(data, first + 1, 1)).toBeNull()
    expect(cell(data, first + 2, 1)).toMatchObject({ value: 'Hortech', rowSpan: 2 })
    expect(cell(data, first, 3)).toMatchObject({ value: '1' })
    expect(cell(data, first + 2, 3)).toMatchObject({ value: '9, 10, 11, 12, 13' })
    expect(cell(data, first, 12)).toMatchObject({ value: `I${first}*K${first}`, type: 'Formula' })
    expect(cell(data, first, 13)).toMatchObject({ value: `J${first}+K${first}` })
    expect(cell(data, first, 14)).toMatchObject({ value: `I${first}*M${first}` })
    expect(cell(data, first, 15)).toMatchObject({ value: 'Bunching by 3' })
    // A missing grower price stays blank instead of showing a wrong number.
    expect(cell(data, first + 3, 10)).toMatchObject({ value: '' })
  })

  it('totals the lines and adds the other costs', () => {
    const { data } = buildProformaSheet(input(true))
    const first = findRow(data, 'Box Number') + 1
    const total = findRow(data, 'Total')
    expect(cell(data, total, 7)).toMatchObject({ value: `SUM(G${first}:G${first + 3})` })
    expect(cell(data, total, 14)).toMatchObject({ value: `SUM(N${first}:N${first + 3})` })
    expect(cell(data, total + 1, 3)).toMatchObject({ value: 'Other costs', rowSpan: 2 })
    expect(cell(data, total + 2, 14)).toMatchObject({ value: 26 })
    expect(cell(data, total + 3, 14)).toMatchObject({ value: `N${total}+SUM(N${total + 1}:N${total + 2})` })
    expect(cell(data, total + 5, 8)).toMatchObject({ value: 'Grand Total' })
    expect(cell(data, total + 5, 14)).toMatchObject({ value: `N${total + 3}` })
    expect(data.some((r) => r.some((c) => (c as CellObject | null)?.value === 'Additional Declaration'))).toBe(true)
  })

  it('leaves prices out of the packing list', () => {
    const { data, columns } = buildProformaSheet(input(false))
    expect(cell(data, 8, 1)).toMatchObject({ value: 'PACKING LIST', columnSpan: 9 })
    const header = findRow(data, 'Box Number')
    expect(data[header - 1]!.map((c) => (c as CellObject).value)).toEqual(['Farm', 'Type', 'Box Number', 'Variety Name', 'Colour', 'Length', 'Boxes', 'Pack Rate', 'Stems', 'Notes'])
    expect(columns).toHaveLength(10)
    expect(data.some((r) => r.some((c) => (c as CellObject | null)?.value === 'Other costs'))).toBe(false)
  })

  it('names files like today', () => {
    expect(proformaFileName(input(true))).toBe('Proforma_CFLPFJ0041_ON_EK_03.08.2026.xlsx')
    expect(proformaFileName(input(false))).toBe('PackingList_CFLPFJ0041_ON_EK_03.08.2026.xlsx')
  })
})
