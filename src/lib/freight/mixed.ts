import { packUld, widthAt, usableVolume, type Placed, type Uld } from './packing'

/**
 * Mixed box sizes into air containers. Each box goes as low, then as far back, then as far left as it fits
 * ("extreme points": the corners left by boxes already placed), turned whichever way fits best; it must stand on
 * the floor or on boxes covering at least 70% of its base. On an AKE a box must clear the wing, which narrows the
 * floor below 51 cm. When a container is full (or at its weight limit), the rest go into the next one.
 * Sizes in mm, weights in kg.
 */
export interface BoxLine {
  key: string
  label: string
  length: number
  width: number
  height: number
  weightKg: number | null
  count: number
}
export interface MixedOptions {
  clearance: number
  allowOnSide: boolean
  /** The order boxes are loaded in: tallest first builds even layers; biggest first fills gaps with small ones. */
  order: 'height' | 'volume' | 'base'
}
export interface MixedPlaced extends Placed {
  /** Index into the box lines. */
  line: number
}
export interface UldLoad {
  boxes: MixedPlaced[]
  grossKg: number
  volumetricKg: number
  fill: number
}
export interface ShipmentPlan {
  uld: Uld
  options: MixedOptions
  loads: UldLoad[]
  /** Per line: boxes that fit nowhere (bigger than the container). */
  unplaced: number[]
  totalBoxes: number
  grossKg: number
  volumetricKg: number
  /** Over all containers but the last, and the last on its own. */
  fill: number
  /** Boxes that stand on their side in this plan. */
  onSide: number
}

const SUPPORT = 0.7

function orientations(l: number, w: number, h: number, onSide: boolean): [number, number, number][] {
  const all: [number, number, number][] = [
    [l, w, h],
    [w, l, h],
  ]
  if (onSide)
    all.push(
      [l, h, w],
      [h, l, w],
      [w, h, l],
      [h, w, l],
    )
  const seen = new Set<string>()
  return all.filter((o) => {
    const k = o.join('x')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Fills one container from the queue (box line indexes, in loading order). Returns the boxes placed. */
function fillOne(u: Uld, lines: BoxLine[], queue: number[], o: MixedOptions): { placed: MixedPlaced[]; rest: number[] } {
  const c = o.clearance
  const maxX = (z: number) => c + widthAt(u, z, c)
  const maxY = u.depth - c
  const maxZ = u.height - c
  const payload = u.maxGrossKg - u.tareKg
  const placed: MixedPlaced[] = []
  let weight = 0
  let points: [number, number, number][] = [[c, c, 0]]
  const rest: number[] = []
  const fits = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => {
    if (x + dx > maxX(z) + 0.01 || y + dy > maxY + 0.01 || z + dz > maxZ + 0.01) return false
    for (const b of placed) if (x < b.x + b.dx && b.x < x + dx && y < b.y + b.dy && b.y < y + dy && z < b.z + b.dz && b.z < z + dz) return false
    if (z > 0) {
      let area = 0
      for (const b of placed) {
        if (Math.abs(b.z + b.dz - z) > 0.5) continue
        const ox = Math.min(x + dx, b.x + b.dx) - Math.max(x, b.x)
        const oy = Math.min(y + dy, b.y + b.dy) - Math.max(y, b.y)
        if (ox > 0 && oy > 0) area += ox * oy
      }
      if (area < SUPPORT * dx * dy) return false
    }
    return true
  }
  for (const li of queue) {
    const line = lines[li]!
    if (line.weightKg && weight + line.weightKg > payload) {
      rest.push(li)
      continue
    }
    let best: { x: number; y: number; z: number; d: [number, number, number]; p: number } | null = null
    const ors = orientations(line.length, line.width, line.height, o.allowOnSide)
    for (let p = 0; p < points.length; p++) {
      const [x, y, z] = points[p]!
      // Points are kept lowest-first; once a fit is found, higher points can't beat it.
      if (best && z > best.z) break
      for (const d of ors) {
        if (!fits(x, y, z, d[0], d[1], d[2])) continue
        const better =
          !best ||
          z < best.z ||
          (z === best.z && (y < best.y || (y === best.y && (x < best.x || (x === best.x && d[0] * d[1] > best.d[0] * best.d[1])))))
        if (better) best = { x, y, z, d, p }
      }
    }
    if (!best) {
      rest.push(li)
      continue
    }
    const [dx, dy, dz] = best.d
    placed.push({ x: best.x, y: best.y, z: best.z, dx, dy, dz, layer: 0, line: li })
    weight += line.weightKg ?? 0
    points.splice(best.p, 1)
    points.push([best.x + dx, best.y, best.z], [best.x, best.y + dy, best.z], [best.x, best.y, best.z + dz])
    // Keep the corners inside the container, unique, lowest first.
    const seen = new Set<string>()
    points = points
      .filter(([x, y, z]) => x < maxX(z) && y < maxY && z < maxZ)
      .filter((p) => {
        const k = p.join(',')
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])
  }
  // Layers for the 3D view's slider: boxes grouped by the height they stand at.
  const levels = [...new Set(placed.map((b) => b.z))].sort((a, b) => a - b)
  for (const b of placed) b.layer = levels.indexOf(b.z)
  return { placed, rest }
}

const vol = (l: BoxLine) => l.length * l.width * l.height
const volKg = (l: BoxLine) => vol(l) / 1000 / 6000

/** Every box of the shipment into as many containers of one kind as it takes (at most `maxUlds`). */
export function planShipment(u: Uld, lines: BoxLine[], o: MixedOptions, maxUlds = 30): ShipmentPlan {
  let queue: number[] = []
  lines.forEach((l, i) => {
    for (let k = 0; k < l.count; k++) queue.push(i)
  })
  const key = (i: number) => {
    const l = lines[i]!
    return o.order === 'height' ? [l.height, vol(l)] : o.order === 'base' ? [l.length * l.width, l.height] : [vol(l), l.height]
  }
  queue.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return kb[0]! - ka[0]! || kb[1]! - ka[1]! || a - b
  })
  const loads: UldLoad[] = []
  // A box that fits in no empty container is set aside straight away.
  const unplaced = lines.map(() => 0)
  const empty = { ...o }
  queue = queue.filter((i) => {
    const l = lines[i]!
    const ok = orientations(l.length, l.width, l.height, empty.allowOnSide).some(([dx, dy, dz]) => dx <= widthAt(u, 0, o.clearance) && dy <= u.depth - 2 * o.clearance && dz <= u.height - o.clearance)
    if (!ok) unplaced[i]!++
    return ok
  })
  while (queue.length && loads.length < maxUlds) {
    const { placed, rest } = fillOne(u, lines, queue, o)
    if (!placed.length) break
    const grossKg = placed.reduce((s, b) => s + (lines[b.line]!.weightKg ?? 0), 0)
    const volumetricKg = placed.reduce((s, b) => s + volKg(lines[b.line]!), 0)
    const v = placed.reduce((s, b) => s + b.dx * b.dy * b.dz, 0)
    loads.push({ boxes: placed, grossKg: Math.round(grossKg * 10) / 10, volumetricKg: Math.round(volumetricKg * 10) / 10, fill: v / usableVolume(u, o.clearance) })
    queue = rest
  }
  for (const i of queue) unplaced[i]!++
  const all = loads.flatMap((l) => l.boxes)
  const onSide = all.filter((b) => {
    const l = lines[b.line]!
    return Math.abs(b.dz - l.height) > 0.5
  }).length
  return {
    uld: u,
    options: o,
    loads,
    unplaced,
    totalBoxes: all.length,
    grossKg: Math.round(loads.reduce((s, l) => s + l.grossKg, 0) * 10) / 10,
    volumetricKg: Math.round(loads.reduce((s, l) => s + l.volumetricKg, 0) * 10) / 10,
    fill: loads.length ? loads.reduce((s, l) => s + l.fill, 0) / loads.length : 0,
    onSide,
  }
}

/** Better plan first: everything loaded, fewer containers, then fuller ones. */
export function comparePlans(a: ShipmentPlan, b: ShipmentPlan) {
  const ua = a.unplaced.reduce((s, n) => s + n, 0)
  const ub = b.unplaced.reduce((s, n) => s + n, 0)
  if (ua !== ub) return ua - ub
  if (a.loads.length !== b.loads.length) return a.loads.length - b.loads.length
  // Same number of containers: the smaller container (less space paid for and booked) first.
  const ca = usableVolume(a.uld, a.options.clearance)
  const cb = usableVolume(b.uld, b.options.clearance)
  if (Math.abs(ca - cb) > 1) return ca - cb
  // Same container: the one that leaves the last container emptiest is the tightest pack.
  const la = a.loads.at(-1)?.fill ?? 0
  const lb = b.loads.at(-1)?.fill ?? 0
  if (Math.abs(la - lb) > 0.005) return la - lb
  return a.onSide - b.onSide
}

export interface Suggestion {
  best: ShipmentPlan
  /** Every container and option tried, best first. */
  tried: ShipmentPlan[]
  /** The best plan keeping every box flat, to show what turning boxes on their side gains. */
  bestFlat: ShipmentPlan | null
  /** The best flat plan in the same container as the best plan. */
  flatSameUld: ShipmentPlan | null
}

/**
 * Tries each container, flat and (if allowed) on the side, and each loading order; for a single box size also the
 * layer-by-layer plan. Returns the best.
 */
export function suggestBestFit(ulds: Uld[], lines: BoxLine[], clearance: number, allowOnSide: boolean): Suggestion {
  const tried: ShipmentPlan[] = []
  for (const u of ulds)
    for (const side of allowOnSide ? [false, true] : [false])
      for (const order of ['height', 'volume', 'base'] as const) tried.push(planShipment(u, lines, { clearance, allowOnSide: side, order }))
  // One box size: the even layer plan is often tighter than corner-filling; use it when it is.
  const one = lines.filter((l) => l.count > 0)
  if (one.length === 1) {
    const l = one[0]!
    for (const u of ulds)
      for (const side of allowOnSide ? [false, true] : [false]) {
        const p = packUld(u, { length: l.length, width: l.width, height: l.height }, { clearance, allowOnSide: side, boxWeightKg: l.weightKg })
        if (!p.total) continue
        const li = lines.indexOf(l)
        const perUld = p.total
        const n = Math.ceil(l.count / perUld)
        const loads: UldLoad[] = []
        for (let k = 0; k < n; k++) {
          const take = Math.min(perUld, l.count - k * perUld)
          const boxes = p.boxes.slice(0, take).map((b) => ({ ...b, line: li }))
          const v = boxes.reduce((s, b) => s + b.dx * b.dy * b.dz, 0)
          loads.push({ boxes, grossKg: Math.round(take * (l.weightKg ?? 0) * 10) / 10, volumetricKg: Math.round(take * volKg(l) * 10) / 10, fill: v / usableVolume(u, clearance) })
        }
        tried.push({
          uld: u,
          options: { clearance, allowOnSide: side, order: 'height' },
          loads,
          unplaced: lines.map(() => 0),
          totalBoxes: l.count,
          grossKg: Math.round(l.count * (l.weightKg ?? 0) * 10) / 10,
          volumetricKg: Math.round(l.count * volKg(l) * 10) / 10,
          fill: loads.reduce((s, x) => s + x.fill, 0) / loads.length,
          onSide: p.standing !== l.height ? l.count : 0,
        })
      }
  }
  tried.sort(comparePlans)
  const best = tried[0]!
  return { best, tried, bestFlat: tried.find((t) => t.onSide === 0) ?? null, flatSameUld: tried.find((t) => t.onSide === 0 && t.uld === best.uld) ?? null }
}
