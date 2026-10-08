import { describe, expect, it } from 'vitest'
import type { ParsedWorkbook } from './parse'
import { awbCheckDigit, emptySnapshot, glnIsValid, validateSheet, type DbSnapshot } from './validate'
import { issuesToCsv } from './errors-csv'

const FARM = {
  farm_code: 'KIBO', farm_name: 'Kibo Roses Ltd', country: 'Kenya', sales_agent_name: 'Ann',
  sales_agent_email: 'ann@kibo.co.ke', currency: 'USD', payment_terms: 'Net 15', active: 'Y',
}

function wb(sheets: Record<string, Record<string, string | number | null>[]>, startRow = 2): ParsedWorkbook {
  return {
    fileName: 'test.xlsx',
    sheets: Object.entries(sheets).map(([name, rows]) => ({
      name,
      headers: [...new Set(rows.flatMap((r) => Object.keys(r)))],
      rows: rows.map((values, i) => ({ row: startRow + i, values })),
    })),
  }
}

function snap(over: Partial<DbSnapshot> = {}): DbSnapshot {
  return {
    ...emptySnapshot(),
    lists: {
      Currency: ['KES', 'USD', 'EUR'], PaymentTerms: ['Prepaid', 'Net 7', 'Net 15', 'Net 30'],
      Country: ['Kenya', 'Netherlands'], Incoterm: ['FCA', 'CPT'], Language: ['EN', 'NL'], Maturity: ['Stage 1', 'Stage 2'],
    },
    ...over,
  }
}

const messages = (r: ReturnType<typeof validateSheet>) => r.issues.map((i) => i.message)

describe('Farms', () => {
  it('accepts a clean row and counts it as new', () => {
    const r = validateSheet(wb({ Farms: [FARM] }), 'Farms', snap())
    expect(r.issues).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.counts).toEqual({ total: 1, inserts: 1, updates: 0 })
    expect(r.rows[0]).toMatchObject({ farm_code: 'KIBO', active: true })
  })

  it('counts an existing code as an update', () => {
    const r = validateSheet(wb({ Farms: [FARM] }), 'Farms', snap({ existingKeys: ['KIBO'] }))
    expect(r.counts).toEqual({ total: 1, inserts: 0, updates: 1 })
  })

  it('reports required fields, bad lists and bad emails in plain words', () => {
    const r = validateSheet(wb({ Farms: [{ ...FARM, farm_name: null, currency: 'GBP', sales_agent_email: 'ann@' }] }), 'Farms', snap())
    expect(r.ok).toBe(false)
    expect(messages(r)).toEqual([
      'Row 2: farm_name is required.',
      "Row 2: sales_agent_email is not a valid email address (found 'ann@').",
      'Row 2: currency GBP is not on the Currency list. Allowed: KES, USD, EUR.',
    ])
    expect(r.issues[0]).toMatchObject({ row: 2, column: 'farm_name', level: 'error' })
  })

  it('rejects the template example row', () => {
    const r = validateSheet(wb({ Farms: [{ ...FARM, farm_code: 'SIAN', farm_name: 'Example Farm Ltd' }] }), 'Farms', snap())
    expect(messages(r)).toEqual(['Row 2: this is still the example row from the template. Overwrite it with real data or delete it.'])
  })

  it('finds duplicate codes', () => {
    const r = validateSheet(wb({ Farms: [FARM, FARM] }), 'Farms', snap())
    expect(messages(r)).toEqual(['Row 3: farm_code KIBO is also on row 2. Each one may appear only once.'])
  })

  it('checks GLN check digits and Y/N', () => {
    const r = validateSheet(wb({ Farms: [{ ...FARM, gln: '8712345678907', active: 'yes' }] }), 'Farms', snap())
    expect(messages(r)).toEqual([
      "Row 2: gln must be 13 digits with a valid check digit (found '8712345678907').",
      "Row 2: active must be Y or N (found 'yes').",
    ])
  })

  it('says when a list value is in the file but Lists is not imported yet', () => {
    const r = validateSheet(
      wb({ Farms: [{ ...FARM, country: 'Japan' }], Lists: [{ list_name: 'Country', value: 'Japan', sort_order: 1 }] }),
      'Farms',
      snap(),
    )
    expect(messages(r)).toEqual(['Row 2: country Japan is on the Lists sheet but not imported yet. Import Lists first.'])
  })

  it('reports a missing required column once, not per row', () => {
    const book = wb({ Farms: [FARM] })
    book.sheets[0]!.headers = book.sheets[0]!.headers.filter((h) => h !== 'sales_agent_email')
    const r = validateSheet(book, 'Farms', snap())
    expect(messages(r)).toEqual(['Column sales_agent_email is missing from the Farms sheet. It is required.'])
  })
})

describe('codes on other sheets', () => {
  const pack = { product_code: 'ROS-1', box_code: 'HBX', bunches_per_box: 8 }

  it('uses the wording "box_code HBX is not on BoxTypes"', () => {
    const r = validateSheet(wb({ PackRates: [pack] }, 14), 'PackRates', snap({ codes: { ...emptySnapshot().codes, product_code: ['ROS-1'] } }))
    expect(messages(r)).toEqual(['Row 14: box_code HBX is not on BoxTypes.'])
  })

  it('tells the user to import the other sheet first', () => {
    const r = validateSheet(
      wb({ PackRates: [pack], BoxTypes: [{ box_code: 'HBX', length_cm: 1, width_cm: 1, height_cm: 1, active: 'Y' }] }),
      'PackRates',
      snap({ codes: { ...emptySnapshot().codes, product_code: ['ROS-1'] } }),
    )
    expect(messages(r)).toEqual(['Row 2: box_code HBX is on the BoxTypes sheet but not imported yet. Import BoxTypes first.'])
  })

  it('hints at case mistakes', () => {
    const r = validateSheet(wb({ PackRates: [{ ...pack, box_code: 'hbx' }] }), 'PackRates', snap({
      codes: { ...emptySnapshot().codes, product_code: ['ROS-1'], box_code: ['HBX'] },
    }))
    expect(messages(r)).toEqual(['Row 2: box_code hbx is not on BoxTypes. Did you mean HBX? Codes are case-sensitive.'])
  })

  it('checks number ranges', () => {
    const r = validateSheet(wb({ PackRates: [{ ...pack, bunches_per_box: 2.5, est_gross_weight_kg: -1 }] }), 'PackRates', snap({
      codes: { ...emptySnapshot().codes, product_code: ['ROS-1'], box_code: ['HBX'] },
    }))
    expect(messages(r)).toEqual([
      'Row 2: bunches_per_box must be a whole number of 1 or more (found 2.5).',
      'Row 2: est_gross_weight_kg must be a number of 0 or more (found -1).',
    ])
  })

  it('names both columns in a composite duplicate', () => {
    const r = validateSheet(wb({ PackRates: [pack, pack] }), 'PackRates', snap({
      codes: { ...emptySnapshot().codes, product_code: ['ROS-1'], box_code: ['HBX'] },
    }))
    expect(messages(r)).toEqual(['Row 3: the same product_code + box_code (ROS-1, HBX) is also on row 2. Each one may appear only once.'])
  })
})

describe('PriceList dates', () => {
  const codes = { ...emptySnapshot().codes, farm_code: ['KIBO'], product_code: ['ROS-1'] }
  const price = { farm_code: 'KIBO', product_code: 'ROS-1', currency: 'USD', price_per_stem: 0.2, valid_from: '2026-11-01' }

  it('accepts Excel date serials and ISO strings', () => {
    const r = validateSheet(wb({ PriceList: [{ ...price, valid_to: 46387 }] }), 'PriceList', snap({ codes }))
    expect(r.issues).toEqual([])
    expect(r.rows[0]).toMatchObject({ valid_from: '2026-11-01', valid_to: '2026-12-31' })
  })

  it('rejects bad dates and reversed ranges', () => {
    const r = validateSheet(
      wb({ PriceList: [{ ...price, valid_from: '01/11/2026' }, { ...price, valid_from: '2026-11-01', valid_to: '2026-10-01' }] }),
      'PriceList',
      snap({ codes }),
    )
    expect(messages(r)).toEqual([
      "Row 2: valid_from must be a date written as YYYY-MM-DD (found '01/11/2026').",
      'Row 3: valid_to (2026-10-01) is before valid_from (2026-11-01).',
    ])
  })
})

describe('PackingList', () => {
  const codes = { farm_code: ['KIBO'], customer_code: ['FLOR'], product_code: ['ROS-1'], box_code: ['QB'] }
  const line = (ref: string, extra: Record<string, string | number> = {}) => ({
    shipment_ref: ref, customer_code: 'FLOR', farm_code: 'KIBO', product_code: 'ROS-1', box_code: 'QB', boxes: 4, ...extra,
  })
  const base = snap({ codes, packRates: ['ROS-1|QB'] })

  it('numbers lines per shipment', () => {
    const r = validateSheet(wb({ PackingList: [line('A'), line('A'), line('B')] }), 'PackingList', base)
    expect(r.ok).toBe(true)
    expect(r.rows.map((x) => `${x.shipment_ref}#${x.line_no}`)).toEqual(['A#1', 'A#2', 'B#1'])
  })

  it('requires rows of one shipment to sit together', () => {
    const r = validateSheet(wb({ PackingList: [line('A'), line('B'), line('A')] }), 'PackingList', base)
    expect(messages(r)).toEqual(['Row 4: shipment_ref A already started on row 2. Rows of one shipment must sit together.'])
  })

  it('refuses closed shipments and removing lines', () => {
    const r = validateSheet(wb({ PackingList: [line('A'), line('B')] }), 'PackingList', {
      ...base, closedShipments: ['A'], shipmentLineCounts: { B: 3 },
    })
    expect(messages(r)).toEqual([
      "Row 2: shipment A is closed, so its packing list can't change.",
      "Shipment B already has 3 lines; this file has 1. An import can't remove lines, so include all 3.",
    ])
  })

  it('needs a pack rate for the product and box', () => {
    const r = validateSheet(wb({ PackingList: [line('A')] }), 'PackingList', { ...base, packRates: [] })
    expect(messages(r)).toEqual(['Row 2: there is no pack rate for ROS-1 in box QB. Add it on PackRates.'])
  })

  it('checks the air waybill check digit and one MAWB per shipment', () => {
    const r = validateSheet(wb({ PackingList: [line('A', { awb: '706-12345675' }), line('A', { awb: '706-12345676' })] }), 'PackingList', base)
    expect(messages(r)).toEqual(['Row 3: awb 706-12345676 has a wrong check digit: the last digit should be 5.'])
    const r2 = validateSheet(wb({ PackingList: [line('A', { awb: '706-12345675' }), line('A', { awb: '706-00000000' })] }), 'PackingList', base)
    expect(messages(r2)).toEqual(['Row 3: awb 706-00000000 differs from 706-12345675 on row 2. A shipment has one master air waybill.'])
  })
})

describe('helpers', () => {
  it('validates GLNs', () => {
    expect(glnIsValid('8712345678906')).toBe(true)
    expect(glnIsValid('8712345678900')).toBe(false)
  })
  it('computes AWB check digits', () => {
    expect(awbCheckDigit('12345675')).toBe(5)
  })
  it('writes a safe CSV', () => {
    const csv = issuesToCsv([{ level: 'error', row: 3, column: 'farm_name', message: '=HYPERLINK("x") "quoted"' }], 'Farms')
    expect(csv).toBe('﻿"sheet","row","column","level","message"\r\n"Farms","3","farm_name","error","\'=HYPERLINK(""x"") ""quoted"""')
  })
})
