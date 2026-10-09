import { ULDS, boxSizes, type Allowances } from './packing'
import { planShipment, type BoxLine, type MixedOptions } from './mixed'

/** A box line as entered: nominal size in mm, its allowances, weight and count. */
export interface BoxSpec {
  key: string
  label: string
  length: number
  width: number
  height: number
  allowances: Allowances
  weightKg: number | null
  count: number
}

/** What the packer works with: the space each box really takes, and its outside size for volumetric weight. */
export function toBoxLine(s: BoxSpec): BoxLine {
  const { outside, space } = boxSizes({ length: s.length, width: s.width, height: s.height }, s.allowances)
  return { key: s.key, label: s.label, ...space, weightKg: s.weightKg, count: s.count, outside }
}

/** A load check: one container as planned, and how many boxes really went in. */
export interface LoadCheck {
  planned: number
  actual: number
  plan: { uldCode: string; options: MixedOptions; lines: BoxSpec[] }
}

/** How close plans came to real loads: 1 − |actual − planned| ÷ actual, averaged. */
export function accuracy(checks: Pick<LoadCheck, 'planned' | 'actual'>[]) {
  if (!checks.length) return null
  return checks.reduce((s, c) => s + Math.max(0, 1 - Math.abs(c.actual - c.planned) / Math.max(c.actual, 1)), 0) / checks.length
}

/** Boxes the planner puts in the first container of a check's plan, with the bulge changed by `delta` mm per face. */
export function replan(c: LoadCheck, delta: number) {
  const u = ULDS.find((x) => x.code === c.plan.uldCode)
  if (!u) return null
  const lines = c.plan.lines.map((l) =>
    toBoxLine({ ...l, allowances: { ...l.allowances, bulgeTopMm: Math.max(0, l.allowances.bulgeTopMm + delta), bulgeSideMm: Math.max(0, l.allowances.bulgeSideMm + delta) } }),
  )
  return planShipment(u, lines, c.plan.options, 1).loads[0]?.boxes.length ?? 0
}

/**
 * The change to the top and side bulge (mm per face, the same for every box type) that would have matched the real
 * loads best, and the accuracy before and after.
 */
export function suggestBulge(checks: LoadCheck[]) {
  if (!checks.length) return null
  let best = { delta: 0, accuracy: accuracy(checks)! }
  for (let d = -15; d <= 40; d++) {
    const a = accuracy(checks.map((c) => ({ actual: c.actual, planned: replan(c, d) ?? c.planned })))!
    if (a > best.accuracy + 1e-9 || (Math.abs(a - best.accuracy) < 1e-9 && Math.abs(d) < Math.abs(best.delta))) best = { delta: d, accuracy: a }
  }
  return { deltaMm: best.delta, before: accuracy(checks)!, after: best.accuracy }
}

/**
 * Real loads against plans, all boxes together: 0.96 means real containers took 96% of what was planned (gaps left
 * by hand, uneven boxes). Unlike bulge, which costs whole rows, this is a smooth correction.
 */
export function loadingFactor(checks: Pick<LoadCheck, 'planned' | 'actual'>[]) {
  const planned = checks.reduce((s, c) => s + c.planned, 0)
  return planned ? checks.reduce((s, c) => s + c.actual, 0) / planned : null
}
