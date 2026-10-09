import { describe, expect, it } from 'vitest'
import { SAMPLE_LABEL_DATA } from '~/lib/labels/data'
import { labelsToZpl } from '~/lib/labels/zpl'
import { backToFarmSticker } from './back-to-farm'

const input = {
  data: SAMPLE_LABEL_DATA,
  reasons: ['Pests or insects'],
  note: 'Thrips on 2 bunches',
  qcBy: 'Wanjiru QC',
  qcAt: '2026-08-02T09:30:00Z',
  widthMm: 150,
  heightMm: 70,
  orientation: 'rotated' as const,
}

describe('BACK TO FARM sticker', () => {
  it('has the white-on-black banner and the reasons', () => {
    const s = backToFarmSticker(input)
    expect(s.ops[0]).toMatchObject({ kind: 'fill', x: 0, y: 0, w: 150 })
    expect(s.ops.find((o) => o.kind === 'text' && o.text === 'BACK TO FARM')).toMatchObject({ color: 'white', bold: true })
    const texts = s.ops.flatMap((o) => (o.kind === 'text' ? [o.text] : []))
    expect(texts.some((t) => t.startsWith('Reason: Pests or insects'))).toBe(true)
    expect(texts.some((t) => t.startsWith(SAMPLE_LABEL_DATA.farmName))).toBe(true)
    expect(texts.some((t) => t.includes('Wanjiru QC') && t.includes('2 Aug 2026'))).toBe(true)
  })

  it('keeps everything on the sticker, in either shape', () => {
    for (const [w, h] of [[150, 70], [100, 150], [100, 100]] as const) {
      const s = backToFarmSticker({ ...input, widthMm: w, heightMm: h })
      for (const o of s.ops) {
        const box = o.kind === 'text' ? { x: o.x, y: o.top, w: o.w, h: o.size } : o.kind === 'qr' ? { x: o.x, y: o.y, w: o.size, h: o.size } : o.kind === 'fill' || o.kind === 'logo' ? o : null
        if (!box) continue
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.x + box.w).toBeLessThanOrEqual(w + 0.01)
        expect(box.y + box.h).toBeLessThanOrEqual(h + 0.01)
      }
    }
  })

  it('prints on Zebra printers with reversed banner text', () => {
    const zpl = labelsToZpl([backToFarmSticker(input)], { dpi: 203 })
    expect(zpl).toContain('^FR')
    expect(zpl).toContain('BACK TO FARM')
  })
})
