import { HELVETICA, HELVETICA_BOLD } from './helvetica-widths'

/** Width of '?' in Helvetica, used for any character the metrics don't know. */
const FALLBACK_WIDTH = 556
/** Text never shrinks below this share of the chosen size; past that it is cut off with "...". */
export const MIN_TEXT_SCALE = 0.7

/**
 * Replaces characters the PDF standard fonts can't draw (outside Western European) with '?'.
 * Applied to every output so the preview, PDF and Zebra label always show the same text.
 */
export function printableText(text: string, bold = false) {
  const table = bold ? HELVETICA_BOLD : HELVETICA
  return [...text.replace(/\s+/g, ' ')].map((ch) => (table[ch.codePointAt(0)!] !== undefined ? ch : '?')).join('')
}

/** Text width in em (multiply by the font size in mm to get mm). */
export function textWidthEm(text: string, bold: boolean) {
  const table = bold ? HELVETICA_BOLD : HELVETICA
  let units = 0
  for (const ch of text) units += table[ch.codePointAt(0)!] ?? FALLBACK_WIDTH
  return units / 1000
}

/**
 * Makes text fit a box: first shrink (down to 70 % of the chosen size), then cut off with "...".
 * Helvetica is wider than the Zebra font, so text that fits here also fits on the printed label.
 */
export function fitText(text: string, sizeMm: number, bold: boolean, maxWidthMm: number) {
  const width = textWidthEm(text, bold) * sizeMm
  if (width <= maxWidthMm) return { text, sizeMm }
  const shrunk = (sizeMm * maxWidthMm) / width
  if (shrunk >= sizeMm * MIN_TEXT_SCALE) return { text, sizeMm: shrunk }
  const size = sizeMm * MIN_TEXT_SCALE
  let cut = text
  while (cut.length > 0 && textWidthEm(`${cut}...`, bold) * size > maxWidthMm) cut = cut.slice(0, -1)
  return { text: cut.length > 0 ? `${cut.trimEnd()}...` : '', sizeMm: size }
}
