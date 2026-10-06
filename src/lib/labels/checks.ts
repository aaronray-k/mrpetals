import { SAMPLE_LABEL_DATA, type LabelData } from './data'
import { elementText, qrModules } from './engine'
import { elementName, isTextLike, overlaps, type LabelDesign, type LabelElement } from './layout'
import { ACTIVE_QR_FORMATTER, type QrFormatter } from './qr-format'
import { fitText, printableText } from './text-fit'
import { FOUR_INCH_PRINT_WIDTH_MM, dotsPerMm, ptToMm } from './units'

export interface DesignWarning {
  /** Elements the warning is about, so the designer can highlight them. */
  elementIds: string[]
  message: string
}

/** Smallest QR module that scans reliably off a thermal printer. */
export const MIN_QR_MODULE_DOTS = 3

export function minQrSizeMm(modulesWithQuietZone: number) {
  return Math.ceil(((MIN_QR_MODULE_DOTS * modulesWithQuietZone) / dotsPerMm(203)) * 2) / 2
}

/** Things that would make a printed label hard to use. Checked against a sample box. */
export function designWarnings(
  design: LabelDesign,
  data: LabelData = SAMPLE_LABEL_DATA,
  formatter: QrFormatter = ACTIVE_QR_FORMATTER,
): DesignWarning[] {
  const warnings: DesignWarning[] = []
  const { elements } = design.layout

  const acrossHead = design.orientation === 'normal' ? design.widthMm : design.heightMm
  if (acrossHead > FOUR_INCH_PRINT_WIDTH_MM) {
    warnings.push({
      elementIds: [],
      message:
        design.orientation === 'normal'
          ? `This label is ${design.widthMm} mm wide, more than a 4-inch printer can print (${FOUR_INCH_PRINT_WIDTH_MM} mm). Switch to rotated feed, or use a 6-inch printer.`
          : `Fed sideways this label is ${design.heightMm} mm across the print head, more than a 4-inch printer can print (${FOUR_INCH_PRINT_WIDTH_MM} mm).`,
    })
  }

  const qr = elements.find((e) => e.type === 'qr')
  if (qr) {
    const modules = qrModules(formatter.format(data), formatter.errorCorrection).length
    const size = Math.min(qr.w, qr.h)
    if (Math.floor((size * dotsPerMm(203)) / modules) < MIN_QR_MODULE_DOTS) {
      warnings.push({
        elementIds: [qr.id],
        message: `The QR code is too small to scan reliably from a 203 dpi printer. Make it at least ${minQrSizeMm(modules)} mm.`,
      })
    }
  }

  for (const el of elements) {
    if (!isTextLike(el)) continue
    const text = printableText(elementText(el, data), el.bold)
    if (!text) continue
    const size = ptToMm(el.fontPt)
    const fit = fitText(text, size, el.bold, el.w)
    if (fit.text !== text) {
      warnings.push({ elementIds: [el.id], message: `${elementName(el)} is cut off on the sample box. Make it wider or the font smaller.` })
    } else if (size > el.h + 0.05) {
      warnings.push({ elementIds: [el.id], message: `${elementName(el)}: the font is taller than its box. Make the box taller or the font smaller.` })
    }
  }

  const reported = new Set<string>()
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i]!
      const b = elements[j]!
      if (!overlaps(a, b)) continue
      const [first, second] = a.type === 'qr' ? [b, a] : [a, b]
      const key = [first.id, second.id].sort().join('|')
      if (reported.has(key)) continue
      reported.add(key)
      warnings.push({
        elementIds: [first.id, second.id],
        message:
          second.type === 'qr'
            ? `${elementName(first)} overlaps the QR code, so it may not scan.`
            : `${elementName(first)} overlaps ${lower(second)}.`,
      })
    }
  }
  return warnings
}

const lower = (el: LabelElement) => {
  const name = elementName(el)
  return /^[A-Z]{2}/.test(name) || name.startsWith('ConsolFlora') || name.startsWith('Box') ? name : name.charAt(0).toLowerCase() + name.slice(1)
}
