import { describe, expect, it } from 'vitest'
import { consolSuffix, farmKey, flowerTypeOf, isFarmCode, matchFarms, nearlySame, parseMasterWorkbook, varietyKeyOf, type RawSheet } from './parse'

// A rose sheet laid out as in the master file: block titles above, a column per length in each block.
const blank = (n: number) => Array<null>(n).fill(null)
const roseTitles = [...blank(5), 'FOB USD', ...blank(4), 'FOB EURO', ...blank(4), 'MARGIN', ...blank(4), 'SELLING PRICE FOB ', ...blank(4), 'PACK RATES', ...blank(4), 'V. Weight ', null, 'Freight Rate ', null, 'Freight Rate ', null, 'Per stem', ...blank(4), 'BUYING CIF', ...blank(3), 'MARGIN', ...blank(3), 'SELLING CIF', ...blank(3), 'TRUCKING TO MADRID', ...blank(3), 'PRICE MADRID', ...blank(3), 'Email Address ', 'Contact ', 'Location ', 'Altitude ']
const lens = ['40cm', '50cm', '60cm', '70cm']
const roseHeader = ['Category', 'Variety', 'Farm ', 'Colour', 'Head Size ', ...lens, null, ...lens, null, ...lens, null, ...lens, null, ...lens, null, 'Std Box', null, 'Per kg ', null, 'Per box ', null, ...lens, null, ...lens, ...lens, ...lens, ...lens, ...lens]
const rose = (cat: string, variety: string, farm: string, usd: number[], email: string | null = null) => [
  cat, variety, farm, 'Red', '5cm+', ...usd, null, ...usd.map((x) => (x ? x - 0.02 : 0)), null, 0.04, 0.05, 0.05, 0.06, null, ...blank(4), null, 500, 400, 340, 280, null, 16, 'Zim Box', 3.83, null, 61.28, null, ...blank(4), null, ...blank(4), ...blank(4), ...blank(4), 0.02, 0.025, 10 / 340, 10 / 280, ...blank(4), email, email && '+254 700', email && 'Nakuru', email && '2,000 m',
]
const roses: RawSheet = {
  sheet: 'Premium Roses ',
  data: [
    [],
    ['CONSOLFLORA PRICES'],
    roseTitles,
    roseHeader,
    rose('Premium Roses ', 'Fuschiana ', 'Baraka Flowers ', [0.16, 0.22, 0.25, 0], 'sales@baraka.example'),
    rose('Premium Roses', 'Athena', 'XFL/ ABL', [0.2, 0.2, 0.2, 0.2]),
    roseHeader, // a repeated header row inside the data
    rose('Spray Roses Premium', 'Fancy', 'Ever Flora', [0.1, 0.1, 0, 0]),
  ],
}
const summer: RawSheet = {
  sheet: 'Summer Flowers ',
  data: [
    [],
    [null, 'CONSOLFLORA - SUMMER FLOWERS ', ...blank(18), 'Buying in Box ', null, 'PRICE BOX NL', 'TRUCKING MADRID', 'PRICE MADRID'],
    [...blank(5), 'Price ', null, 'Price ', null, 'CONSOLFLORA Margin', null, 'SELLING FOB ', null, 'Packrates', null, 'V. Weight ', null, 'F. Rate ', 'F.Rate ', 'F. cost', 'CIF PRICE ', 'CONSOLFLORA  Margin ', 'CIF PRICE '],
    ['Farms ', 'Product', 'Variety', 'Colour /vareity ', 'Length ', 'USD', null, 'EURO', ...blank(3), 'Price', null, 'per box', null, 'Std Box', null, 'Per kg ', 'Per box ', 'Per stem'],
    [],
    ['CONSOL - Afri ', 'Erugium ', 'Orion', 'Blue', '60cm', 0.3, null, 0.28, null, 0.04, null, null, null, 200, null, 12, null, 3.83, null, null, null, 0.05, null, 0.02, null],
    ['Africalla', 'Gypsohilla', 'Xlence', 'White', '80cm', 0.5, null, 0.45, null, 0.04, null, null, null, 100, null, 12, null, 3.83, null, null, null, 0.05, null, 0.02, null],
    ['CONSOL - Deli', 'Hydragea ', 'Bianca', 'White', '60cm', 0, null, 0, null, 0.06, null, null, null, 50, null, 7, null, 3.83, null, null, null, 0.05, null, 0.02, null],
  ],
}

describe('master price file', () => {
  const m = parseMasterWorkbook([roses, summer, { sheet: 'Premium Roses OFFER', data: [['x']] }])

  it('skips OFFER sheets, farm codes, repeated headers and lengths with no price', () => {
    expect(m.sheets.map((s) => [s.name, s.read])).toEqual([['Premium Roses', true], ['Summer Flowers', true], ['Premium Roses OFFER', false]])
    expect(m.skipped.map((s) => [s.farmRaw, s.reason])).toEqual([['XFL/ ABL', 'code'], ['CONSOL - Deli', 'no price']])
    const fus = m.rows.filter((r) => r.variety === 'Fuschiana')
    expect(fus.map((r) => r.lengthCm)).toEqual([40, 50, 60])
    expect(m.rows.filter((r) => r.variety === 'Fancy').map((r) => r.lengthCm)).toEqual([40, 50])
  })

  it('reads the inputs per length: farm prices, margins, pack rate, box weight, freight and trucking', () => {
    const r = m.rows.find((x) => x.variety === 'Fuschiana' && x.lengthCm === 60)!
    expect(r).toMatchObject({ farmRaw: 'Baraka Flowers', category: 'Premium Roses', fobUsd: 0.25, fobEur: 0.23, fobMargin: 0.05, stemsPerBox: 340, boxWeightKg: 16, boxName: 'Zim Box', freightPerKg: 3.83, truckingPerBox: 10 })
    expect(m.contacts).toEqual([{ farmRaw: 'Baraka Flowers', email: 'sales@baraka.example', phone: '+254 700', location: 'Nakuru', altitude: '2,000 m' }])
    const s = m.rows.find((x) => x.variety === 'Orion')!
    expect(s).toMatchObject({ category: 'Erugium', lengthCm: 60, fobUsd: 0.3, fobEur: 0.28, fobMargin: 0.04, cifMargin: 0.05, stemsPerBox: 200, boxWeightKg: 12, freightPerKg: 3.83, truckingPerStem: 0.02 })
  })

  it('CONSOL- farms: matched to the farm whose name starts with the suffix, else the suffix kept', () => {
    expect(consolSuffix('CONSOL- Afri')).toBe('Afri')
    expect(consolSuffix('Africalla')).toBeNull()
    const { farms, byRaw } = matchFarms([{ farmRaw: 'CONSOL - Afri' }, { farmRaw: 'Africalla' }, { farmRaw: 'CONSOL- Sosi' }, { farmRaw: 'Ever Flora' }, { farmRaw: 'Everflora' }, { farmRaw: 'Everflora' }])
    expect(byRaw.get('CONSOL - Afri')).toBe('Africalla')
    expect(byRaw.get('CONSOL- Sosi')).toBe('Sosi')
    expect(byRaw.get('Ever Flora')).toBe('Everflora')
    expect(farms.map((f) => [f.name, f.how, f.rows])).toEqual([['Africalla', 'consol matched', 2], ['Everflora', 'name', 3], ['Sosi', 'consol suffix', 1]])
  })

  it('farm codes and spellings', () => {
    expect(['XFL', 'ABL/BVL', 'SSL/ XFL'].every(isFarmCode)).toBe(true)
    expect(['TAMBUZI', 'ZEE Flora', 'Amor'].some(isFarmCode)).toBe(false)
    expect(farmKey('Eco Roses ltd ( BTG)')).toBe(farmKey('Eco Roses (BTG)'))
  })

  it('flower types and grades for the webshop; one entry per flower and variety', () => {
    expect(flowerTypeOf('Summer Flowers', 'Gypsohilla')).toEqual({ flowerType: 'Gypsophila', grade: null })
    expect(flowerTypeOf('Summer Flowers', 'Erugium')).toEqual({ flowerType: 'Eryngium', grade: null })
    expect(flowerTypeOf('Summer Flowers', 'Std. Carnations').flowerType).toBe('Standard Carnation')
    expect(flowerTypeOf('Summer Flowers', 'Spray Carnations').flowerType).toBe('Spray Carnation')
    expect(flowerTypeOf('Premium Roses', 'Super Intermediate roses')).toEqual({ flowerType: 'Rose', grade: 'Super Intermediate' })
    expect(flowerTypeOf('Garden & Normal Spray Roses', 'Spray Rose Reqular')).toEqual({ flowerType: 'Spray Rose', grade: 'Regular' })
    expect(flowerTypeOf('Garden Roses & Scented  Roses', 'David Austin Roses')).toEqual({ flowerType: 'Garden Rose', grade: 'David Austin' })
    expect(varietyKeyOf('Rose', 'Pink Athena ')).toBe(varietyKeyOf('Rose', 'pink athena'))
    expect(nearlySame('confidential', 'confidendtial')).toBe(true)
    expect(nearlySame('abba', 'abbe')).toBe(false)
  })
})
