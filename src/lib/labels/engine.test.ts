import { describe, expect, it } from 'vitest'
import { designWarnings } from './checks'
import { SAMPLE_LABEL_DATA } from './data'
import { elementText, renderLabel } from './engine'
import {
  REQUIRED_TYPES,
  SIZE_PRESETS,
  clampElement,
  defaultLayout,
  defaultOrientation,
  fitLayoutToLabel,
  parseLayout,
  type BoxCountElement,
  type FieldElement,
  type LabelDesign,
} from './layout'
import { placeholderQrFormatter } from './qr-format'
import { fitText, printableText, textWidthEm } from './text-fit'

const design = (w: number, h: number): LabelDesign => ({
  widthMm: w,
  heightMm: h,
  orientation: defaultOrientation(w, h),
  layout: defaultLayout(w, h),
})

describe('default layouts', () => {
  for (const p of [...SIZE_PRESETS, { id: 'custom', w: 120, h: 80 }, { id: 'small', w: 60, h: 40 }]) {
    it(`${p.w} × ${p.h}: complete, inside the label, and valid`, () => {
      const d = design(p.w, p.h)
      for (const t of REQUIRED_TYPES) expect(d.layout.elements.filter((e) => e.type === t)).toHaveLength(1)
      for (const e of d.layout.elements) {
        expect(e.x + e.w, e.id).toBeLessThanOrEqual(p.w + 1e-9)
        expect(e.y + e.h, e.id).toBeLessThanOrEqual(p.h + 1e-9)
      }
      expect(() => parseLayout(JSON.parse(JSON.stringify(d.layout)))).not.toThrow()
    })
  }

  for (const p of SIZE_PRESETS) {
    it(`${p.label} has no warnings`, () => {
      expect(designWarnings(design(p.w, p.h)).map((w) => w.message)).toEqual([])
    })
  }

  it('feeds wide labels sideways on 4-inch printers', () => {
    expect(defaultOrientation(150, 70)).toBe('rotated')
    expect(defaultOrientation(100, 150)).toBe('normal')
  })
})

describe('layout rules', () => {
  it('rejects a layout without the QR code, box id or box count', () => {
    const layout = defaultLayout(150, 70)
    for (const t of REQUIRED_TYPES) {
      const without = { ...layout, elements: layout.elements.filter((e) => e.type !== t) }
      expect(() => parseLayout(without), t).toThrow(`exactly one ${t}`)
    }
  })

  it('keeps elements inside the label and QR codes square', () => {
    expect(clampElement({ id: 'q', type: 'qr', x: 140, y: 60, w: 40, h: 30 }, 150, 70)).toEqual({ id: 'q', type: 'qr', x: 120, y: 40, w: 30, h: 30 })
    const shrunk = fitLayoutToLabel(defaultLayout(150, 70), 100, 50)
    for (const e of shrunk.elements) expect(e.x + e.w <= 100 && e.y + e.h <= 50, e.id).toBe(true)
  })
})

describe('text', () => {
  it('measures with Helvetica metrics', () => {
    expect(textWidthEm('AAAA', false)).toBeCloseTo(4 * 0.667)
    expect(textWidthEm('AAAA', true)).toBeCloseTo(4 * 0.722)
  })

  it('shrinks, then cuts off text that is too long', () => {
    expect(fitText('Short', 5, false, 50)).toEqual({ text: 'Short', sizeMm: 5 })
    const shrunk = fitText('Example Flowers BV', 5, true, 45)
    expect(shrunk.text).toBe('Example Flowers BV')
    expect(shrunk.sizeMm).toBeLessThan(5)
    const cut = fitText('A very long buyer name that cannot possibly fit', 5, true, 30)
    expect(cut.text.endsWith('...')).toBe(true)
    expect(textWidthEm(cut.text, true) * cut.sizeMm).toBeLessThanOrEqual(30)
  })

  it('replaces characters the label fonts cannot print', () => {
    expect(printableText('Café Ölund — Цветы')).toBe('Café Ölund — ?????')
  })

  it('prints captions in English or Dutch', () => {
    const variety: FieldElement = { id: 'v', type: 'field', field: 'variety', x: 0, y: 0, w: 50, h: 6, fontPt: 11, bold: false, align: 'left', caption: 'en' }
    expect(elementText(variety, SAMPLE_LABEL_DATA)).toBe('Variety: Red Naomi')
    expect(elementText({ ...variety, caption: 'nl' }, SAMPLE_LABEL_DATA)).toBe('Ras: Red Naomi')
    expect(elementText({ ...variety, caption: 'none' }, SAMPLE_LABEL_DATA)).toBe('Red Naomi')
    expect(elementText({ ...variety, field: 'hawb' }, { ...SAMPLE_LABEL_DATA, hawb: null })).toBe('')
  })

  it('writes "Box n of N" in words or numbers', () => {
    const count: BoxCountElement = { id: 'c', type: 'box_count', x: 0, y: 0, w: 50, h: 8, fontPt: 16, bold: true, align: 'center', caption: 'en', style: 'words' }
    expect(elementText(count, SAMPLE_LABEL_DATA)).toBe('Box 42 of 180')
    expect(elementText({ ...count, caption: 'nl' }, SAMPLE_LABEL_DATA)).toBe('Doos 42 van 180')
    expect(elementText({ ...count, style: 'numbers' }, SAMPLE_LABEL_DATA)).toBe('042 / 180')
  })
})

describe('renderLabel', () => {
  it('draws the QR code with the active formatter and adds REPRINT only on reprints', () => {
    const d = design(150, 70)
    const normal = renderLabel(d, SAMPLE_LABEL_DATA)
    expect(normal.qrText).toBe('CF1|10042|SHP-2026-0001|42/180')
    expect(normal.ops.filter((o) => o.kind === 'qr')).toHaveLength(1)
    expect(normal.ops.some((o) => o.kind === 'text' && o.text === 'REPRINT')).toBe(false)
    const reprint = renderLabel(d, SAMPLE_LABEL_DATA, { reprint: true })
    expect(reprint.ops.some((o) => o.kind === 'fill')).toBe(true)
    expect(reprint.ops.some((o) => o.kind === 'text' && o.text === 'REPRINT' && o.color === 'white')).toBe(true)
  })

  it('skips fields the box has no value for', () => {
    const d = design(100, 150)
    const texts = (data = SAMPLE_LABEL_DATA) => renderLabel(d, data).ops.filter((o) => o.kind === 'text').length
    expect(texts({ ...SAMPLE_LABEL_DATA, mawb: null })).toBe(texts() - 1)
  })
})

describe('QR formatter', () => {
  it('reads back what it writes, and nothing else', () => {
    const text = placeholderQrFormatter.format(SAMPLE_LABEL_DATA)
    expect(placeholderQrFormatter.parse(text)).toEqual({ boxId: 10042 })
    expect(placeholderQrFormatter.parse('https://example.com')).toBeNull()
    expect(placeholderQrFormatter.parse('CF1|abc|x|1/2')).toBeNull()
  })
})

describe('warnings', () => {
  const d = design(150, 70)
  const qr = d.layout.elements.find((e) => e.type === 'qr')!
  const edit = (fn: (e: (typeof d.layout.elements)[number]) => (typeof d.layout.elements)[number]) => ({
    ...d,
    layout: { ...d.layout, elements: d.layout.elements.map(fn) },
  })
  const messages = (x: LabelDesign) => designWarnings(x).map((w) => w.message)

  it('flags text over the QR code', () => {
    const moved = edit((e) => (e.id === 'f-variety' ? { ...e, x: qr.x - 5, y: qr.y + 2 } : e))
    expect(messages(moved)).toContain('Variety overlaps the QR code, so it may not scan.')
  })

  it('flags a QR code too small for 203 dpi', () => {
    const small = edit((e) => (e.type === 'qr' ? { ...e, w: 8, h: 8 } : e))
    expect(messages(small).some((m) => m.startsWith('The QR code is too small to scan reliably'))).toBe(true)
  })

  it('flags labels too wide for a 4-inch printer', () => {
    expect(messages({ ...d, orientation: 'normal' }).some((m) => m.includes('more than a 4-inch printer'))).toBe(true)
  })
})

describe('adding elements', () => {
  it('places new fields in a free spot', async () => {
    const { newElement, overlaps } = await import('./layout')
    const layout = defaultLayout(100, 150)
    const el = newElement('field', 100, 150, 'colour', layout.elements)
    expect(layout.elements.some((e) => overlaps(e, el))).toBe(false)
    expect(el.x + el.w).toBeLessThanOrEqual(100)
  })
})
