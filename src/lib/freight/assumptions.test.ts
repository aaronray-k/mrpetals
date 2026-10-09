import { describe, expect, it } from 'vitest'
import { DEFAULT_ALLOWANCES, ULDS } from './packing'
import { assumptionEffects, fullContainer, stemsEffect } from './assumptions'
import type { BoxSpec } from './calibrate'

const ake = ULDS.find((u) => u.code === 'AKE')!
const hb = (over: Partial<BoxSpec> = {}): BoxSpec => ({ key: 'hb', label: 'HB', length: 1000, width: 500, height: 300, allowances: DEFAULT_ALLOWANCES, weightKg: 14, count: 10, ...over })

describe('assumptions and their effect', () => {
  it('a full container: the mix scaled up until one container is full', () => {
    const a = fullContainer(ake, [hb({ count: 3 })], { clearance: 20, allowOnSide: false, order: 'height' })
    const b = fullContainer(ake, [hb({ count: 300 })], { clearance: 20, allowOnSide: false, order: 'height' })
    expect(a.boxes).toBe(b.boxes)
    expect(a.boxes).toBeGreaterThan(10)
  })

  it('bulge and space kept free cost boxes; each is measured on its own', () => {
    // 10 mm bulge on a 30 cm box (32 cm a layer) still fits five layers in an AKE; 20 mm (34 cm) fits only four.
    expect(assumptionEffects(ake, [hb()], { clearance: 20, allowOnSide: false, order: 'height' }).effects[0]!.effect).toBe(0)
    const r = assumptionEffects(ake, [hb({ allowances: { ...DEFAULT_ALLOWANCES, bulgeTopMm: 20 } })], { clearance: 20, allowOnSide: false, order: 'height' })
    const by = Object.fromEntries(r.effects.map((e) => [e.key, e]))
    expect(by.bulge!.boxesWithout).toBeGreaterThan(r.base)
    expect(by.bulge!.effect).toBeLessThan(0)
    expect(by.clearance!.effect).toBeLessThanOrEqual(0)
    // Outside sizes: thickness already counted, no effect.
    expect(by.wall!.effect).toBe(0)
    // Effect = (with − without) ÷ without.
    expect(by.bulge!.effect).toBeCloseTo((r.base - by.bulge!.boxesWithout) / by.bulge!.boxesWithout, 10)
  })

  it('walls count only for sizes measured inside', () => {
    const r = assumptionEffects(ake, [hb({ allowances: { ...DEFAULT_ALLOWANCES, sizes: 'inside', wallMm: 7 } })], { clearance: 20, allowOnSide: false, order: 'height' })
    expect(r.effects.find((e) => e.key === 'wall')!.effect).toBeLessThan(0)
  })

  it('stems: a bulging box holding more stems can make up for fewer boxes', () => {
    // 20 boxes with bulge against 24 ideal, 400 stems a box; bulging boxes hold 10% more.
    const s = stemsEffect(20, 24, 400, 10, 2000)
    expect(s.withStems).toBe(8800)
    expect(s.idealStems).toBe(9600)
    expect(s.change).toBeCloseTo(-0.0833, 3)
    expect(s.perStemWith!).toBeCloseTo(2000 / 8800, 6)
  })
})
