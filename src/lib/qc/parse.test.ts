import { describe, expect, it } from 'vitest'
import { parseScan } from './parse'

describe('parseScan', () => {
  it('reads our QR codes', () => {
    expect(parseScan('CF1|10000042|SHP-2026-0042|42/180')).toEqual({ boxId: 10000042 })
    // BACK TO FARM stickers carry no box number.
    expect(parseScan('CF1|10000042|SHP-2026-0042|0/0')).toEqual({ boxId: 10000042 })
    expect(parseScan('CF2|10000042|SHP-2026-0042|42/180|VBN:13000|S20:070|PKG:901|Q:160')).toEqual({
      boxId: 10000042,
      codes: { VBN: '13000', S20: '070', PKG: '901', Q: '160' },
    })
  })
  it('accepts a typed box id, with spaces', () => {
    expect(parseScan(' 1000 0042 ')).toEqual({ boxId: 10000042 })
  })
  it('explains anything else in plain words', () => {
    expect(parseScan('')).toEqual({ error: 'Scan a box label, or type the box id.' })
    expect(parseScan('4006381333931')).toMatchObject({ error: expect.stringContaining('not a ConsolFlora box label') })
  })
})
