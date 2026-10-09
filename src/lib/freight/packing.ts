/**
 * How many flower boxes of one size fit in an air cargo container (ULD), layer by layer, and where each goes.
 * All sizes in mm. x runs across the container's width, y front to back, z up.
 *
 * Each layer is filled on its own floor area: the AKE is narrower at the bottom (its wing slants out from the floor
 * to 510 mm up), so a layer gets the width available at its own bottom. Within a layer the boxes may be turned
 * (and mixed: some one way, the rest the other) to fit the most; boxes stay flat unless turning them on their side
 * is allowed. The weight limit caps the count.
 */

export interface Uld {
  code: string
  name: string
  /** Floor width (x) and depth (y). */
  width: number
  depth: number
  height: number
  /** AKE-style wing: the width grows from `width` at the floor to `fullWidth` at `wingTop` mm up. */
  fullWidth?: number
  wingTop?: number
  maxGrossKg: number
  tareKg: number
  note: string
}

export const ULDS: Uld[] = [
  { code: 'AKE', name: 'AKE (LD3) container', width: 1562, depth: 1534, height: 1630, fullWidth: 2002, wingTop: 510, maxGrossKg: 1588, tareKg: 80, note: 'Lower deck. Wing on one side from 510 mm up.' },
  { code: 'PMC-LD', name: 'PMC pallet, lower deck (163 cm)', width: 3175, depth: 2438, height: 1630, maxGrossKg: 5035, tareKg: 110, note: '96 × 125 in pallet; lower-deck height.' },
  { code: 'PMC-MD244', name: 'PMC pallet, main deck (244 cm)', width: 3175, depth: 2438, height: 2438, maxGrossKg: 6804, tareKg: 110, note: 'Main deck, 96 in high.' },
  { code: 'PMC-MD300', name: 'PMC pallet, main deck (300 cm)', width: 3175, depth: 2438, height: 2997, maxGrossKg: 6804, tareKg: 110, note: 'Main deck, 118 in high. The top corners are contoured on most aircraft: check the top layer with the airline.' },
]

export interface BoxSize {
  length: number
  width: number
  height: number
}
export interface PackOptions {
  /** Kept free on every side for the walls, net and loading (mm). */
  clearance: number
  /** Boxes may be turned on their side (otherwise they stay flat, height up). */
  allowOnSide: boolean
  /** Weight of one full box, kg; with it, the container's weight limit caps the count. */
  boxWeightKg: number | null
}
export interface Placed {
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
  layer: number
}
export interface PackResult {
  boxes: Placed[]
  layers: { z: number; height: number; count: number; floorWidth: number }[]
  /** Boxes on the bottom layer. */
  bottomLayer: number
  total: number
  /** Whether the weight limit, not space, stopped the count. */
  weightLimited: boolean
  /** Share of the container's usable volume the boxes take. */
  fill: number
  grossKg: number | null
  payloadKg: number
  /** Airline volumetric weight: L × W × H (cm) ÷ 6000 per box. */
  volumetricKg: number
  /** The box's height in this plan (the side standing up). */
  standing: number
}

/** The usable width at height z (after clearance). */
export function widthAt(u: Uld, z: number, clearance: number) {
  const full = u.fullWidth && u.wingTop ? u.width + (u.fullWidth - u.width) * Math.min(1, Math.max(0, z / u.wingTop)) : u.width
  return full - 2 * clearance
}

/** Usable volume, mm³ (the wing counted as its sloped shape). */
export function usableVolume(u: Uld, clearance: number) {
  const h = u.height - clearance
  const d = u.depth - 2 * clearance
  if (!u.fullWidth || !u.wingTop) return (u.width - 2 * clearance) * d * h
  const wing = Math.min(u.wingTop, h)
  const avgLow = (widthAt(u, 0, clearance) + widthAt(u, wing, clearance)) / 2
  return (avgLow * wing + widthAt(u, u.wingTop, clearance) * Math.max(0, h - wing)) * d
}

interface Rect {
  x: number
  y: number
  w: number
  d: number
}
const grid = (W: number, D: number, a: number, b: number, x0 = 0, y0 = 0): Rect[] => {
  const nx = Math.floor(W / a)
  const ny = Math.floor(D / b)
  const out: Rect[] = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) out.push({ x: x0 + i * a, y: y0 + j * b, w: a, d: b })
  return out
}

/**
 * The most a × b rectangles in a W × D floor: all one way, or two blocks (split across or along) each turned its
 * own way. Exact for most box and pallet sizes; never worse than a plain grid.
 */
export function packFloor(W: number, D: number, a: number, b: number): Rect[] {
  if (W <= 0 || D <= 0) return []
  let best = grid(W, D, a, b)
  const consider = (r: Rect[]) => {
    if (r.length > best.length) best = r
  }
  consider(grid(W, D, b, a))
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const) {
    // Split across the width: k columns turned one way, the rest the other.
    for (let k = 1; k * p < W; k++) consider([...grid(k * p, D, p, q), ...grid(W - k * p, D, q, p, k * p, 0)])
    // Split along the depth.
    for (let k = 1; k * q < D; k++) consider([...grid(W, k * q, p, q), ...grid(W, D - k * q, q, p, 0, k * q)])
  }
  return best
}

/** The plan for one box size in one container. */
export function packUld(u: Uld, box: BoxSize, o: PackOptions): PackResult {
  const dims = [box.length, box.width, box.height]
  // Which side stands up: the height, or (on its side) any of the three.
  const standings = o.allowOnSide ? [...new Set(dims)] : [box.height]
  const payloadKg = u.maxGrossKg - u.tareKg
  const cap = o.boxWeightKg && o.boxWeightKg > 0 ? Math.floor(payloadKg / o.boxWeightKg) : Infinity
  let best: PackResult | null = null
  for (const h of standings) {
    const rest = [...dims]
    rest.splice(rest.indexOf(h), 1)
    const [a, b] = rest as [number, number]
    const boxes: Placed[] = []
    const layers: PackResult['layers'] = []
    const top = u.height - o.clearance
    for (let z = 0, i = 0; z + h <= top; z += h, i++) {
      const W = widthAt(u, z, o.clearance)
      const D = u.depth - 2 * o.clearance
      const floor = packFloor(W, D, a, b)
      layers.push({ z, height: h, count: floor.length, floorWidth: W })
      for (const r of floor) boxes.push({ x: o.clearance + r.x, y: o.clearance + r.y, z, dx: r.w, dy: r.d, dz: h, layer: i })
    }
    // The weight limit: fill from the bottom up.
    const kept = boxes.slice(0, Math.min(boxes.length, cap))
    let left = kept.length
    for (const l of layers) {
      l.count = Math.min(l.count, left)
      left -= l.count
    }
    const usedLayers = layers.filter((l) => l.count > 0)
    const vol = box.length * box.width * box.height
    const r: PackResult = {
      boxes: kept,
      layers: usedLayers,
      bottomLayer: usedLayers[0]?.count ?? 0,
      total: kept.length,
      weightLimited: boxes.length > cap,
      fill: (kept.length * vol) / usableVolume(u, o.clearance),
      grossKg: o.boxWeightKg ? Math.round(kept.length * o.boxWeightKg * 10) / 10 : null,
      payloadKg,
      volumetricKg: Math.round(((kept.length * vol) / 1000 / 6000) * 10) / 10,
      standing: h,
    }
    if (!best || r.total > best.total || (r.total === best.total && r.layers.length < best.layers.length)) best = r
  }
  return best!
}

/** Freight for a load: the airline charges the higher of actual and volumetric weight. */
export function chargeableKg(r: Pick<PackResult, 'grossKg' | 'volumetricKg'>) {
  return Math.max(r.grossKg ?? 0, r.volumetricKg)
}
