import { boxSizes, type Uld } from './packing'
import { planShipment, type MixedOptions } from './mixed'
import { toBoxLine, type BoxSpec } from './calibrate'

/**
 * How much each assumption moves the estimate. The measure is boxes in a full container: the box mix (in its
 * proportions) is scaled up until one container is full, then planned again without that one assumption.
 */
export interface Effect {
  key: 'bulge' | 'wall' | 'clearance' | 'onSide' | 'weight'
  label: string
  /** The assumption as used, in words. */
  used: string
  /** Boxes in a full container with every assumption, and without this one. */
  boxesWith: number
  boxesWithout: number
  /** (with − without) ÷ without: negative when the assumption costs boxes. */
  effect: number
  note: string
}

/**
 * Boxes of this mix in one full container: the best over the loading orders, and (when turning is allowed) over
 * flat and on-side plans, since allowing a box on its side never forces it there.
 */
export function fullContainer(u: Uld, specs: BoxSpec[], o: MixedOptions) {
  const total = specs.reduce((s, x) => s + x.count, 0)
  if (!total) return { boxes: 0, grossKg: 0, volumetricKg: 0 }
  // Enough boxes, in the same proportions, to fill the container whatever the mix.
  const scale = Math.max(1, Math.ceil(400 / total))
  const lines = specs.map((s) => toBoxLine({ ...s, count: s.count * scale }))
  let best = { boxes: 0, grossKg: 0, volumetricKg: 0 }
  for (const side of o.allowOnSide ? [false, true] : [false])
    for (const order of ['height', 'volume', 'base'] as const) {
      const l = planShipment(u, lines, { ...o, allowOnSide: side, order }, 1).loads[0]
      if (l && l.boxes.length > best.boxes) best = { boxes: l.boxes.length, grossKg: l.grossKg, volumetricKg: l.volumetricKg }
    }
  return best
}

const mm = (n: number) => `${n} mm`

export function assumptionEffects(u: Uld, specs: BoxSpec[], o: MixedOptions): { base: number; effects: Effect[] } {
  const base = fullContainer(u, specs, o).boxes
  const effect = (without: number) => (without ? (base - without) / without : 0)
  const out: Effect[] = []
  const strip = (f: (s: BoxSpec) => BoxSpec) => specs.map(f)

  const bulges = [...new Set(specs.map((s) => `${s.allowances.bulgeTopMm}/${s.allowances.bulgeSideMm}/${s.allowances.bulgeEndMm}`))]
  const noBulge = fullContainer(u, strip((s) => ({ ...s, allowances: { ...s.allowances, bulgeTopMm: 0, bulgeSideMm: 0, bulgeEndMm: 0 } })), o).boxes
  const gained = specs.length
    ? specs.reduce((sum, s) => {
        const { outside, space } = boxSizes(s, s.allowances)
        return sum + (space.length * space.width * space.height) / (outside.length * outside.width * outside.height) - 1
      }, 0) / specs.length
    : 0
  out.push({
    key: 'bulge',
    label: 'Bulging',
    used: `${bulges.join(', ')} mm (top / sides / ends, per face)`,
    boxesWith: base,
    boxesWithout: noBulge,
    effect: effect(noBulge),
    note: `Each box takes about ${(gained * 100).toFixed(1)}% more space than its outside size. A bulging box usually also holds more stems: see stems below.`,
  })

  const inside = specs.filter((s) => s.allowances.sizes === 'inside')
  const noWall = inside.length ? fullContainer(u, strip((s) => ({ ...s, allowances: { ...s.allowances, wallMm: 0 } })), o).boxes : base
  out.push({
    key: 'wall',
    label: 'Board thickness',
    used: inside.length ? `${[...new Set(inside.map((s) => mm(s.allowances.wallMm)))].join(', ')} walls on boxes measured inside` : 'Sizes are outside sizes: thickness already counted',
    boxesWith: base,
    boxesWithout: noWall,
    effect: effect(noWall),
    note: 'Only boxes measured inside get the wall added (twice per direction). The airline measures outside sizes for volumetric weight.',
  })

  const noClear = fullContainer(u, specs, { ...o, clearance: 0 }).boxes
  out.push({
    key: 'clearance',
    label: 'Space kept free',
    used: `${o.clearance / 10} cm each side and on top`,
    boxesWith: base,
    boxesWithout: noClear,
    effect: effect(noClear),
    note: 'For the container walls, the net and straps, and room to load by hand.',
  })

  const flip = fullContainer(u, specs, { ...o, allowOnSide: !o.allowOnSide }).boxes
  out.push({
    key: 'onSide',
    label: 'Laying boxes on their side',
    used: o.allowOnSide ? 'Allowed (used where it fits more)' : 'Not allowed: every box flat',
    boxesWith: base,
    boxesWithout: flip,
    effect: effect(flip),
    note: o.allowOnSide ? 'Gain from turning boxes over when that fits more.' : 'What allowing it would change (negative: it would fit more).',
  })

  const weighed = specs.some((s) => s.weightKg)
  const noWeight = weighed ? fullContainer(u, strip((s) => ({ ...s, weightKg: null })), o).boxes : base
  out.push({
    key: 'weight',
    label: 'Weight limit',
    used: weighed ? `${u.maxGrossKg - u.tareKg} kg payload (${u.code})` : 'No box weights entered: not checked',
    boxesWith: base,
    boxesWithout: noWeight,
    effect: effect(noWeight),
    note: 'Wet packing, hydration and gel packs make boxes heavier than their nominal weight.',
  })
  return { base, effects: out }
}

/**
 * Stems per full container and freight per stem: as planned (bulge counted, a bulging box holding `extraPct` more
 * stems) against ideal flat boxes at the nominal stem count.
 */
export function stemsEffect(boxesWith: number, boxesIdeal: number, stemsPerBox: number, extraPct: number, freightPerContainer: number | null) {
  const withStems = boxesWith * stemsPerBox * (1 + extraPct / 100)
  const idealStems = boxesIdeal * stemsPerBox
  return {
    withStems: Math.round(withStems),
    idealStems: Math.round(idealStems),
    change: idealStems ? (withStems - idealStems) / idealStems : 0,
    perStemWith: freightPerContainer != null && withStems ? freightPerContainer / withStems : null,
    perStemIdeal: freightPerContainer != null && idealStems ? freightPerContainer / idealStems : null,
  }
}

/** Freight factors not in the model yet, with what each can do to an estimate. */
export const NOT_MODELLED: { label: string; risk: string }[] = [
  { label: 'Crush limit', risk: 'Corrugated flower boxes crush under too many layers; handlers may cap the stack. Fewer layers than the container height allows.' },
  { label: 'Airflow for cooling', risk: 'Gaps left for cold air between rows on long flights take space, often a few percent.' },
  { label: 'Farm box sizes', risk: 'Boxes from different farms differ from the stated size by a centimetre or more; it adds up across a row.' },
  { label: 'Wet weight', risk: 'Hydrated flowers, wet sleeves and gel or ice packs add weight beyond the nominal figure.' },
  { label: 'ULD pivot weight', risk: 'Airlines charge a minimum (pivot) weight per container; a light container is charged as if it weighed that.' },
  { label: 'Contour and aircraft', risk: 'Main-deck PMC outlines and lower-deck limits differ by aircraft; the top corners of a 300 cm PMC are rounded off.' },
  { label: 'Loading by hand', risk: 'Real loads leave small gaps the plan does not. Load checks measure this and tune the bulge.' },
]
