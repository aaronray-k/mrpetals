import { describe, expect, it } from 'vitest'
import { createBitmap, qrBitmap, rotateCW, toZplGraphic, type MonoBitmap } from './bitmap'
import { SAMPLE_LABEL_DATA } from './data'
import { renderLabel, type RenderedLabel } from './engine'
import { defaultLayout, type LabelDesign } from './layout'
import { labelsToZpl, zplText } from './zpl'

/** Decoder for Zebra's ASCII graphic compression, to check the encoder against. */
function decompress(data: string, bytesPerRow: number, rows: number): string[] {
  const out: string[] = []
  let row = ''
  let count = 0
  const value = (ch: string) => {
    const small = 'GHIJKLMNOPQRSTUVWXY'.indexOf(ch)
    if (small >= 0) return small + 1
    const large = 'ghijklmnopqrstuvwxyz'.indexOf(ch)
    return large >= 0 ? (large + 1) * 20 : 0
  }
  const endRow = () => {
    out.push(row)
    row = ''
  }
  for (const ch of data) {
    if (value(ch)) count += value(ch)
    else if (ch === ',') {
      row = row.padEnd(bytesPerRow * 2, '0')
      endRow()
    } else if (ch === '!') {
      row = row.padEnd(bytesPerRow * 2, 'F')
      endRow()
    } else if (ch === ':') {
      if (row) throw new Error('":" inside a row')
      out.push(out[out.length - 1]!)
    } else {
      row += ch.repeat(count || 1)
      count = 0
      if (row.length === bytesPerRow * 2) endRow()
    }
  }
  expect(out).toHaveLength(rows)
  return out
}

function plainHex(bm: MonoBitmap) {
  const bytesPerRow = Math.ceil(bm.width / 8)
  return Array.from({ length: bm.height }, (_, y) =>
    Array.from({ length: bytesPerRow }, (_, b) => {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) if (b * 8 + bit < bm.width && bm.bits[y * bm.width + b * 8 + bit]) byte |= 0x80 >> bit
      return byte.toString(16).toUpperCase().padStart(2, '0')
    }).join(''),
  )
}

function randomBitmap(w: number, h: number, seed: number): MonoBitmap {
  const bm = createBitmap(w, h)
  let s = seed
  for (let i = 0; i < bm.bits.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    // Mostly runs, like real graphics, with whole blank and solid rows.
    const y = Math.floor(i / w)
    bm.bits[i] = y % 7 === 0 ? 0 : y % 11 === 0 ? 1 : (s >> 16) % 9 < 3 ? 1 : 0
  }
  return bm
}

const fakeLogo = (_v: string, w: number, h: number) => {
  const bm = createBitmap(w, h)
  bm.bits.fill(1, 0, w) // top row black
  return bm
}

const label = (w: number, h: number, orientation: 'normal' | 'rotated', reprint = false): RenderedLabel => {
  const design: LabelDesign = { widthMm: w, heightMm: h, orientation, layout: defaultLayout(w, h) }
  return renderLabel(design, SAMPLE_LABEL_DATA, { reprint })
}

describe('graphics', () => {
  it('compresses losslessly', () => {
    for (const [w, h, seed] of [[1, 1, 1], [9, 3, 2], [64, 40, 3], [333, 61, 4], [1200, 20, 5]] as const) {
      const bm = randomBitmap(w, h, seed)
      const g = toZplGraphic(bm)
      expect(g.totalBytes).toBe(Math.ceil(w / 8) * h)
      expect(decompress(g.data, g.bytesPerRow, h)).toEqual(plainHex(bm))
    }
  })

  it('compresses blank and solid rows to one character', () => {
    const bm = createBitmap(80, 3)
    bm.bits.fill(1, 80, 160)
    expect(toZplGraphic(bm).data).toBe(',!,')
  })

  it('rotates clockwise', () => {
    const bm = createBitmap(3, 2) // top-left dot black
    bm.bits[0] = 1
    const r = rotateCW(bm)
    expect([r.width, r.height]).toEqual([2, 3])
    expect(r.bits[1]).toBe(1) // now top-right
  })

  it('draws QR modules at whole-dot sizes', () => {
    const bm = qrBitmap([[true, false], [false, true]], 3)
    expect([bm.width, bm.height]).toEqual([6, 6])
    expect(bm.bits[0]).toBe(1)
    expect(bm.bits[3]).toBe(0)
    expect(bm.bits[5 * 6 + 5]).toBe(1)
  })
})

describe('labelsToZpl', () => {
  it('escapes characters ZPL treats as commands', () => {
    expect(zplText('A^B~C_D\\E')).toBe('A_5EB_7EC_5FD\\\\E')
  })

  it('sizes the label in dots at 203 and 300 dpi', () => {
    const z203 = labelsToZpl([label(100, 150, 'normal')], { dpi: 203, logoBitmap: fakeLogo })
    expect(z203).toContain('^PW799\n^LL1199')
    const z300 = labelsToZpl([label(100, 150, 'normal')], { dpi: 300, logoBitmap: fakeLogo })
    expect(z300).toContain('^PW1181\n^LL1772')
  })

  it('feeds rotated labels sideways', () => {
    const zpl = labelsToZpl([label(150, 70, 'rotated')], { dpi: 203, logoBitmap: fakeLogo })
    // 70 mm across the print head (559 dots), 150 mm long (1199 dots).
    expect(zpl).toContain('^PW559\n^LL1199')
    expect(zpl).toMatch(/\^A0R,/)
    expect(zpl).not.toMatch(/\^A0N,/)
    // Logo at 32,32 dots, 336 x 129 dots: turned clockwise it starts at X = 559 - (32 + 129) = 398, Y = 32.
    expect(zpl).toContain('^FO398,32^XGR:CFLG1.GRF,1,1^FS')
  })

  it('sends the logo once and deletes it afterwards', () => {
    const zpl = labelsToZpl([label(150, 70, 'normal'), label(150, 70, 'normal')], { dpi: 203, logoBitmap: fakeLogo })
    expect(zpl.match(/~DGR:CFLG1\.GRF/g)).toHaveLength(1)
    expect(zpl.match(/\^XGR:CFLG1\.GRF/g)).toHaveLength(2)
    expect(zpl.match(/\^XA\n/g)).toHaveLength(2)
    expect(zpl.trimEnd().endsWith('^XA^IDR:CFLG*.GRF^FS^XZ')).toBe(true)
  })

  it('prints the QR code as a graphic and bold text twice', () => {
    const zpl = labelsToZpl([label(150, 70, 'normal')], { dpi: 203, logoBitmap: fakeLogo })
    expect(zpl.match(/\^GFA,/g)).toHaveLength(1)
    expect(zpl.match(/\^FDBox 42 of 180\^FS/g)).toHaveLength(2)
    expect(zpl.match(/\^FDBox ID: 00010042\^FS/g)).toHaveLength(1)
  })

  it('prints REPRINT reversed out of a black box', () => {
    const zpl = labelsToZpl([label(150, 70, 'normal', true)], { dpi: 203, logoBitmap: fakeLogo })
    expect(zpl).toMatch(/\^GB\d+,\d+,\d+,B,0\^FS/)
    expect(zpl.match(/\^FR\^FH_\^FDREPRINT\^FS/g)).toHaveLength(1)
  })
})
