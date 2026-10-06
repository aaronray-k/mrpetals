import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { readXlsx, type ParsedWorkbook } from './parse'
import { SHEETS, SHEET_ORDER } from './schema'
import { emptySnapshot, validateSheet } from './validate'

const load = (path: string) => {
  const buf = readFileSync(resolve(__dirname, path))
  return readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, path)
}

let template: ParsedWorkbook
beforeAll(async () => {
  template = await load('../../../public/templates/ConsolFlora_Import_Template.xlsx')
})

describe('the published template matches schema.ts', () => {
  for (const name of SHEET_ORDER.filter((s) => s !== 'Lists')) {
    it(`${name} has the same columns, in order`, () => {
      const sheet = template.sheets.find((s) => s.name === name)
      expect(sheet?.headers).toEqual(SHEETS[name].columns.map((c) => c.key))
    })
  }

  it('reads the Lists sheet and skips the note at the bottom', () => {
    const lists = template.sheets.find((s) => s.name === 'Lists')!
    const currency = lists.rows.filter((r) => r.values.list_name === 'Currency').map((r) => r.values.value)
    expect(currency).toEqual(['KES', 'USD', 'EUR'])
    expect(lists.rows.some((r) => String(r.values.value).startsWith('Edit these lists'))).toBe(false)
  })

  it('skips rows that only hold formulas', () => {
    for (const name of ['BoxTypes', 'PackRates', 'PackingList']) {
      expect(template.sheets.find((s) => s.name === name)?.rows.map((r) => r.row)).toEqual([2])
    }
  })

  it('reads dates as YYYY-MM-DD', () => {
    expect(template.sheets.find((s) => s.name === 'PriceList')?.rows[0]?.values).toMatchObject({
      valid_from: '2026-10-01',
      valid_to: '2026-12-31',
    })
  })

  it('refuses to import the untouched example rows', () => {
    for (const name of SHEET_ORDER.filter((s) => s !== 'Lists')) {
      const r = validateSheet(template, name, emptySnapshot())
      expect(r.ok, name).toBe(false)
      expect(r.issues.map((i) => i.message), name).toContain(
        'Row 2: this is still the example row from the template. Overwrite it with real data or delete it.',
      )
    }
  })
})

describe('workbooks saved by other tools', () => {
  // openpyxl writes absolute part paths; the previous reader (exceljs) crashed on them.
  it('reads a filled-in template saved by openpyxl', async () => {
    const wb = await load('./__fixtures__/filled-saved-by-openpyxl.xlsx')
    const farms = wb.sheets.find((s) => s.name === 'Farms')!
    expect(farms.rows.map((r) => r.values.farm_code)).toEqual(['KIBO', 'NAKU'])
    const snap = { ...emptySnapshot(), lists: { Country: ['Kenya'], Currency: ['USD'], PaymentTerms: ['Net 7', 'Net 15'] } }
    expect(validateSheet(wb, 'Farms', snap).issues).toEqual([])
  })
})
