import { describe, expect, it } from 'vitest'
import { SAMPLE_LABEL_DATA } from '~/lib/labels/data'
import { defaultLayout } from '~/lib/labels/layout'
import { renderPrintRows, toLabelData } from './print-boxes'

// What box_label_data() returns (numbers can arrive as numbers or strings).
const json = { ...SAMPLE_LABEL_DATA, headSizeCm: '5.5', grossWeightKg: null, hawb: null, boxNo: 7, boxTotal: '148' } as Record<string, unknown>

describe('printing real boxes', () => {
  it('reads box data from the database into label data', () => {
    const d = toLabelData(json)
    expect(d.headSizeCm).toBe(5.5)
    expect(d.boxTotal).toBe(148)
    expect(d.hawb).toBeNull()
    expect(d.customerName).toBe('Example Flowers BV')
  })

  it('draws each box with its template version, with REPRINT only on reprints', () => {
    const row = (kind: 'print' | 'reprint') => ({
      box_id: 10000007,
      kind,
      template_version_id: 'v1',
      width_mm: 150,
      height_mm: 70,
      orientation: 'rotated' as const,
      layout: defaultLayout(150, 70),
      data: json,
    })
    const [first, again] = renderPrintRows([row('print'), row('reprint')])
    const texts = (l: typeof first) => l!.ops.flatMap((o) => (o.kind === 'text' ? [o.text] : []))
    expect(texts(first)).toContain('Box 7 of 148')
    expect(texts(first)).not.toContain('REPRINT')
    expect(texts(again)).toContain('REPRINT')
    expect(first!.orientation).toBe('rotated')
  })
})
