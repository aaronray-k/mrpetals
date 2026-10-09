import { describe, expect, it } from 'vitest'
import { ULDS, chargeableKg, packFloor, packUld, usableVolume, widthAt } from './packing'

const ake = ULDS.find((u) => u.code === 'AKE')!
const pmc = ULDS.find((u) => u.code === 'PMC-LD')!
const overlaps = (a: { x: number; y: number; z: number; dx: number; dy: number; dz: number }, b: typeof a) =>
  a.x < b.x + b.dx && b.x < a.x + a.dx && a.y < b.y + b.dy && b.y < a.y + a.dy && a.z < b.z + b.dz && b.z < a.z + a.dz

describe('floor packing', () => {
  it('turns the boxes when that fits more', () => {
    expect(packFloor(1200, 800, 400, 300)).toHaveLength(8)
  })
  it('mixes two blocks turned different ways when neither grid is best', () => {
    // 1000 × 700 floor, 400 × 300 boxes: a plain grid fits 4; a row of two, then three turned, fits 5.
    const r = packFloor(1000, 700, 400, 300)
    expect(r).toHaveLength(5)
    for (const a of r) expect(a.x + a.w <= 1000 && a.y + a.d <= 700).toBe(true)
  })
  it('an empty floor or a box bigger than it fits none', () => {
    expect(packFloor(300, 300, 400, 400)).toHaveLength(0)
  })
})

describe('container plans', () => {
  it('the AKE is narrower below its wing', () => {
    expect(widthAt(ake, 0, 0)).toBe(1562)
    expect(widthAt(ake, 255, 0)).toBe(1782)
    expect(widthAt(ake, 600, 0)).toBe(2002)
    expect(widthAt(ake, 600, 20)).toBe(1962)
  })

  it('a flower box in an AKE: layer by layer, nothing overlapping, nothing outside', () => {
    // 100 × 45 × 30 cm box, flat.
    const r = packUld(ake, { length: 1000, width: 450, height: 300 }, { clearance: 20, allowOnSide: false, boxWeightKg: null })
    expect(r.layers.map((l) => l.z)).toEqual([0, 300, 600, 900, 1200])
    // Bottom (1522 × 1494 usable): 1000 × 450 one way fits 3, turned 450 × 1000 fits 3; mixed fits 4.
    expect(r.bottomLayer).toBe(4)
    expect(r.total).toBe(r.layers.reduce((s, l) => s + l.count, 0))
    for (const b of r.boxes) {
      expect(b.x + b.dx).toBeLessThanOrEqual(20 + widthAt(ake, b.z, 20) + 0.001)
      expect(b.y + b.dy).toBeLessThanOrEqual(ake.depth - 20)
      expect(b.z + b.dz).toBeLessThanOrEqual(ake.height - 20)
    }
    for (let i = 0; i < r.boxes.length; i++) for (let j = i + 1; j < r.boxes.length; j++) expect(overlaps(r.boxes[i]!, r.boxes[j]!)).toBe(false)
    // Above the wing the floor is wider, so upper layers hold at least as many.
    expect(r.layers.at(-1)!.count).toBeGreaterThanOrEqual(r.layers[0]!.count)
    expect(r.fill).toBeGreaterThan(0.5)
    expect(r.fill).toBeLessThanOrEqual(1)
  })

  it('the weight limit caps the count, filling from the bottom', () => {
    const r = packUld(ake, { length: 1000, width: 450, height: 300 }, { clearance: 20, allowOnSide: false, boxWeightKg: 100 })
    expect(r.total).toBe(Math.floor((ake.maxGrossKg - ake.tareKg) / 100))
    expect(r.weightLimited).toBe(true)
    expect(r.grossKg).toBe(r.total * 100)
  })

  it('on its side only when allowed, and only if it fits more', () => {
    const box = { length: 1000, width: 400, height: 500 }
    const flat = packUld(pmc, box, { clearance: 0, allowOnSide: false, boxWeightKg: null })
    const any = packUld(pmc, box, { clearance: 0, allowOnSide: true, boxWeightKg: null })
    expect(flat.standing).toBe(500)
    expect(any.total).toBeGreaterThanOrEqual(flat.total)
  })

  it('volumetric and chargeable weight', () => {
    const r = packUld(pmc, { length: 1000, width: 500, height: 300 }, { clearance: 0, allowOnSide: false, boxWeightKg: 12 })
    // 100 × 50 × 30 cm = 25 kg volumetric per box: the airline charges that, not 12 kg.
    expect(r.volumetricKg).toBeCloseTo(r.total * 25, 5)
    expect(chargeableKg(r)).toBe(r.volumetricKg)
    expect(usableVolume(pmc, 0)).toBe(3175 * 2438 * 1630)
  })
})
