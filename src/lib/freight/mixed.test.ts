import { describe, expect, it } from 'vitest'
import { ULDS, packUld, widthAt } from './packing'
import { planShipment, suggestBestFit, type BoxLine, type ShipmentPlan } from './mixed'

const ake = ULDS.find((u) => u.code === 'AKE')!
const pmc = ULDS.find((u) => u.code === 'PMC-LD')!
const line = (key: string, l: number, w: number, h: number, count: number, kg: number | null = null): BoxLine => ({ key, label: key, length: l, width: w, height: h, weightKg: kg, count })

function checkSound(p: ShipmentPlan, clearance: number) {
  const u = p.uld
  for (const load of p.loads) {
    const bs = load.boxes
    for (const b of bs) {
      expect(b.x).toBeGreaterThanOrEqual(clearance - 0.01)
      expect(b.x + b.dx).toBeLessThanOrEqual(clearance + widthAt(u, b.z, clearance) + 0.01)
      expect(b.y + b.dy).toBeLessThanOrEqual(u.depth - clearance + 0.01)
      expect(b.z + b.dz).toBeLessThanOrEqual(u.height - clearance + 0.01)
      if (b.z > 0) {
        // Stands on boxes covering at least 70% of its base.
        let area = 0
        for (const o of bs) {
          if (Math.abs(o.z + o.dz - b.z) > 0.5) continue
          const ox = Math.min(b.x + b.dx, o.x + o.dx) - Math.max(b.x, o.x)
          const oy = Math.min(b.y + b.dy, o.y + o.dy) - Math.max(b.y, o.y)
          if (ox > 0 && oy > 0) area += ox * oy
        }
        expect(area).toBeGreaterThanOrEqual(0.7 * b.dx * b.dy - 1)
      }
    }
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i]!, b = bs[j]!
        const overlap = a.x < b.x + b.dx && b.x < a.x + a.dx && a.y < b.y + b.dy && b.y < a.y + a.dy && a.z < b.z + b.dz && b.z < a.z + a.dz
        expect(overlap).toBe(false)
      }
  }
}

describe('mixed boxes', () => {
  // A typical flower shipment: half, quarter and procona-sized boxes.
  const shipment = [line('HB', 1000, 500, 300, 18, 14), line('QB', 1000, 250, 150, 40, 7), line('PRO', 600, 400, 500, 10, 9)]

  it('loads a mixed shipment soundly: inside the AKE (wing included), nothing overlapping, every box supported', () => {
    const p = planShipment(ake, shipment, { clearance: 20, allowOnSide: false, order: 'height' })
    expect(p.totalBoxes + p.unplaced.reduce((s, n) => s + n, 0)).toBe(68)
    expect(p.unplaced.every((n) => n === 0)).toBe(true)
    checkSound(p, 20)
    expect(p.loads.length).toBeGreaterThanOrEqual(1)
  })

  it('overflows into further containers and counts every box once', () => {
    const p = planShipment(ake, [line('HB', 1000, 500, 300, 60)], { clearance: 20, allowOnSide: false, order: 'volume' })
    expect(p.loads.length).toBeGreaterThan(1)
    expect(p.loads.reduce((s, l) => s + l.boxes.length, 0)).toBe(60)
    checkSound(p, 20)
  })

  it('stops a container at its weight limit', () => {
    const p = planShipment(ake, [line('HEAVY', 400, 300, 200, 40, 100)], { clearance: 0, allowOnSide: false, order: 'volume' })
    for (const l of p.loads) expect(l.grossKg).toBeLessThanOrEqual(ake.maxGrossKg - ake.tareKg)
    expect(p.loads.length).toBeGreaterThan(1)
  })

  it('a box too big for the container is reported, not lost', () => {
    const p = planShipment(ake, [line('XL', 2500, 500, 300, 2), line('HB', 1000, 500, 300, 3)], { clearance: 0, allowOnSide: false, order: 'volume' })
    expect(p.unplaced).toEqual([2, 0])
    expect(p.totalBoxes).toBe(3)
  })

  it('best fit: on its side when that fits more, and never worse than the layer plan for one size', () => {
    // 70 cm tall boxes: flat, only two layers fit 163 cm; on their side (40 or 60 cm tall) more fit.
    const tall = [line('TALL', 600, 400, 700, 120)]
    const flat = suggestBestFit([pmc], tall, 0, false)
    const side = suggestBestFit([pmc], tall, 0, true)
    const perUld = (p: ShipmentPlan) => p.loads[0]!.boxes.length
    expect(perUld(side.best)).toBeGreaterThan(perUld(flat.best))
    expect(side.best.onSide).toBeGreaterThan(0)
    expect(side.bestFlat).not.toBeNull()
    const layer = packUld(pmc, { length: 600, width: 400, height: 700 }, { clearance: 0, allowOnSide: false, boxWeightKg: null })
    expect(perUld(flat.best)).toBeGreaterThanOrEqual(layer.total)
    checkSound(side.best, 0)
  })

  it('picks the container type that needs the fewest', () => {
    const s = suggestBestFit([ake, pmc], [line('HB', 1000, 500, 300, 60)], 20, false)
    expect(s.best.uld.code).toBe('PMC-LD')
    expect(s.tried.length).toBeGreaterThan(4)
  })

  it('a small load goes in the smaller container when both hold it all', () => {
    const s = suggestBestFit([ake, pmc], [line('HB', 1000, 500, 300, 8)], 20, true)
    expect(s.best.uld.code).toBe('AKE')
    expect(s.best.loads).toHaveLength(1)
  })

  it('a few hundred mixed boxes plan quickly', () => {
    const many = [line('HB', 1000, 500, 300, 120), line('QB', 1000, 250, 150, 200), line('PRO', 600, 400, 500, 60)]
    const t = Date.now()
    const p = planShipment(pmc, many, { clearance: 20, allowOnSide: true, order: 'height' })
    expect(Date.now() - t).toBeLessThan(4000)
    expect(p.totalBoxes).toBe(380)
  })
})
