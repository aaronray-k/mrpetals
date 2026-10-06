import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { SAMPLE_LABEL_DATA } from './data'
import { renderLabel } from './engine'
import { defaultLayout } from './layout'
import { labelsToPdf } from './pdf'

const logo = readFileSync(resolve(__dirname, '../../../public/labels/consolflora-logo-full.png'))

describe('labelsToPdf', () => {
  it('makes one page per label at the real size, rotated for sideways feed', async () => {
    const make = (w: number, h: number, orientation: 'normal' | 'rotated') =>
      renderLabel({ widthMm: w, heightMm: h, orientation, layout: defaultLayout(w, h) }, SAMPLE_LABEL_DATA)
    const bytes = await labelsToPdf([make(150, 70, 'rotated'), make(100, 150, 'normal')], { full: logo })
    const pdf = await PDFDocument.load(bytes)
    const [a, b] = pdf.getPages()
    expect(pdf.getPageCount()).toBe(2)
    expect(a!.getWidth()).toBeCloseTo((150 * 72) / 25.4, 1)
    expect(a!.getHeight()).toBeCloseTo((70 * 72) / 25.4, 1)
    expect(a!.getRotation().angle).toBe(90)
    expect(b!.getRotation().angle).toBe(0)
    expect(pdf.getTitle()).toBe('ConsolFlora box labels')
  })
})
