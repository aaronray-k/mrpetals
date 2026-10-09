import { describe, expect, it } from 'vitest'
import { LOGO_ASPECT, defaultLayout, type LabelDesign } from '~/lib/labels/layout'
import { designerReducer, type DesignerState } from './use-designer'

const design: LabelDesign = { widthMm: 150, heightMm: 70, orientation: 'rotated', layout: defaultLayout(150, 70) }
const start: DesignerState = { design, meta: { name: 'Standard', customerId: null, isDefault: true }, selectedId: null, past: [], future: [] }
const el = (s: DesignerState, id: string) => s.design.layout.elements.find((e) => e.id === id)!

describe('designerReducer', () => {
  it('undoes and redoes changes', () => {
    const moved = designerReducer(start, { type: 'update', id: 'f-variety', patch: { x: 10 } })
    expect(el(moved, 'f-variety').x).toBe(10)
    const undone = designerReducer(moved, { type: 'undo' })
    expect(el(undone, 'f-variety').x).toBe(4)
    expect(el(designerReducer(undone, { type: 'redo' }), 'f-variety').x).toBe(10)
  })

  it('makes a drag one undo step', () => {
    let s = designerReducer(start, { type: 'checkpoint' })
    for (const x of [5, 6, 7, 8]) s = designerReducer(s, { type: 'update', id: 'f-variety', patch: { x }, record: false })
    expect(s.past).toHaveLength(1)
    expect(el(designerReducer(s, { type: 'undo' }), 'f-variety').x).toBe(4)
  })

  it('never removes the QR code, box id, box count or reprint mark', () => {
    for (const id of ['qr', 'box_id', 'box_count', 'reprint']) {
      expect(designerReducer(start, { type: 'remove', id })).toBe(start)
    }
    const s = designerReducer(start, { type: 'remove', id: 'f-grade' })
    expect(s.design.layout.elements.some((e) => e.id === 'f-grade')).toBe(false)
  })

  it('keeps the QR code square and the logo in proportion', () => {
    const qr = el(designerReducer(start, { type: 'update', id: 'qr', patch: { w: 30 } }), 'qr')
    expect([qr.w, qr.h]).toEqual([30, 30])
    const logo = el(designerReducer(start, { type: 'update', id: 'logo', patch: { w: 30 } }), 'logo')
    expect(logo.h).toBeCloseTo(30 / LOGO_ASPECT.full, 1)
  })

  it('keeps elements on the label when it gets smaller', () => {
    const s = designerReducer(start, { type: 'size', widthMm: 100, heightMm: 50 })
    for (const e of s.design.layout.elements) expect(e.x + e.w <= 100 && e.y + e.h <= 50, e.id).toBe(true)
  })

  it('switches captions to Dutch, leaving "no caption" fields alone', () => {
    const s = designerReducer(start, { type: 'captions', lang: 'nl' })
    expect(el(s, 'f-grade')).toMatchObject({ caption: 'nl' })
    expect(el(s, 'f-variety')).toMatchObject({ caption: 'none' })
    expect(el(s, 'box_count')).toMatchObject({ caption: 'nl' })
  })
})

describe('undo steps', () => {
  it('records nothing for unrecorded size and feed changes', () => {
    let s = designerReducer(start, { type: 'checkpoint' })
    s = designerReducer(s, { type: 'size', widthMm: 100, heightMm: 100, record: false })
    s = designerReducer(s, { type: 'orientation', orientation: 'normal', record: false })
    expect(s.past).toHaveLength(1)
    const undone = designerReducer(s, { type: 'undo' })
    expect([undone.design.widthMm, undone.design.orientation]).toEqual([150, 'rotated'])
  })
})

describe('edit sessions', () => {
  it('turns one focus of a field into one undo step, and focusing alone records nothing', () => {
    let s = start
    for (const w of [1, 12, 120]) s = designerReducer(s, { type: 'size', widthMm: Math.max(w, 20), heightMm: 70, group: 'w:1' })
    expect(s.past).toHaveLength(1)
    // Focusing the next field records nothing until it changes something.
    expect(designerReducer(s, { type: 'undo' }).design.widthMm).toBe(150)
    s = designerReducer(s, { type: 'size', widthMm: 120, heightMm: 80, group: 'h:1' })
    expect(s.past).toHaveLength(2)
    expect(designerReducer(s, { type: 'undo' }).design.heightMm).toBe(70)
  })

  it('starts a new step when the same field is focused again', () => {
    let s = designerReducer(start, { type: 'meta', patch: { name: 'A' }, group: 'name:1' })
    s = designerReducer(s, { type: 'meta', patch: { name: 'AB' }, group: 'name:1' })
    s = designerReducer(s, { type: 'meta', patch: { name: 'ABC' }, group: 'name:2' })
    expect(s.past).toHaveLength(2)
    expect(designerReducer(s, { type: 'undo' }).meta.name).toBe('AB')
  })
})
