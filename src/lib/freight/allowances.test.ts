import { describe, expect, it } from 'vitest'
import { DEFAULT_ALLOWANCES, NO_ALLOWANCES, ULDS, boxSizes, packUld } from './packing'
import { accuracy, replan, suggestBulge, toBoxLine, type BoxSpec, type LoadCheck } from './calibrate'

const ake = ULDS.find((u) => u.code === 'AKE')!
const half = { length: 1000, width: 500, height: 300 }

describe('box thickness and bulging', () => {
  it('outside sizes are used as they are; inside sizes get the wall on both sides', () => {
    expect(boxSizes(half, { ...NO_ALLOWANCES, wallMm: 5 }).outside).toEqual(half)
    expect(boxSizes(half, { ...NO_ALLOWANCES, sizes: 'inside', wallMm: 5 }).outside).toEqual({ length: 1010, width: 510, height: 310 })
  })

  it('bulge on both faces adds to the space a box takes, not to what the airline measures', () => {
    const { outside, space } = boxSizes(half, DEFAULT_ALLOWANCES)
    expect(outside).toEqual(half)
    // 10 mm top and bottom, 5 mm each long side, ends flat.
    expect(space).toEqual({ length: 1000, width: 510, height: 320 })
    const line = toBoxLine({ key: 'a', label: 'HB', ...half, allowances: DEFAULT_ALLOWANCES, weightKg: null, count: 1 })
    expect(line.height).toBe(320)
    expect(line.outside).toEqual(half)
  })

  it('bulge costs boxes: fewer fit than the ideal flat box', () => {
    const ideal = packUld(ake, half, { clearance: 20, allowOnSide: false, boxWeightKg: null })
    const { outside, space } = boxSizes(half, { ...DEFAULT_ALLOWANCES, bulgeTopMm: 15 })
    const real = packUld(ake, space, { clearance: 20, allowOnSide: false, boxWeightKg: null, outside })
    // 33 cm a layer instead of 30: four layers instead of five.
    expect(real.layers.length).toBeLessThan(ideal.layers.length)
    expect(real.total).toBeLessThan(ideal.total)
    // Volumetric weight still from the outside size.
    expect(real.volumetricKg).toBeCloseTo(real.total * 25, 5)
  })
})

describe('load checks', () => {
  const spec = (bulgeTop: number): BoxSpec => ({ key: 'hb', label: 'HB', ...half, allowances: { ...DEFAULT_ALLOWANCES, bulgeTopMm: bulgeTop }, weightKg: null, count: 60 })
  const check = (bulgeTop: number, actual: number): LoadCheck => {
    const c: LoadCheck = { planned: 0, actual, plan: { uldCode: 'AKE', options: { clearance: 20, allowOnSide: false, order: 'height' }, lines: [spec(bulgeTop)] } }
    c.planned = replan(c, 0)!
    return c
  }

  it('accuracy: how close plans came to real loads', () => {
    expect(accuracy([{ planned: 20, actual: 20 }])).toBe(1)
    expect(accuracy([{ planned: 21, actual: 20 }, { planned: 20, actual: 20 }])).toBeCloseTo(0.975, 5)
    expect(accuracy([])).toBeNull()
  })

  it('suggests the bulge that would have matched what really went in', () => {
    // The boxes really bulged 25 mm a face: the planner, told 10 mm, promised too many.
    const truth = replan(check(25, 0), 0)!
    const c = check(10, truth)
    expect(c.planned).toBeGreaterThan(truth)
    const s = suggestBulge([c])!
    expect(s.after).toBe(1)
    expect(s.before).toBeLessThan(1)
    expect(replan(c, s.deltaMm)).toBe(truth)
  })

  it('and the other way: boxes that bulge less than assumed fit more', () => {
    const truth = replan(check(0, 0), 0)!
    const c = check(20, truth)
    expect(c.planned).toBeLessThan(truth)
    const s = suggestBulge([c])!
    expect(s.deltaMm).toBeLessThan(0)
    expect(replan(c, s.deltaMm)).toBe(truth)
  })
})
