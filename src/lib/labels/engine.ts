import QRCode from 'qrcode'
import { formatBoxId, type LabelData } from './data'
import { fieldDef } from './fields'
import {
  LOGO_ASPECT,
  isTextLike,
  type Align,
  type LabelDesign,
  type LabelElement,
  type LogoVariant,
  type ReprintElement,
  type TextLikeElement,
} from './layout'
import { ACTIVE_QR_FORMATTER, type QrFormatter } from './qr-format'
import { fitText, printableText } from './text-fit'
import { ptToMm } from './units'

/** Baseline position inside a text cell, as a share of the font size. Matches the Zebra scalable font. */
export const TEXT_ASCENT = 0.8
/** White border around the QR code, in modules. Part of the QR element's box. */
export const QR_QUIET_MODULES = 2

/**
 * Drawing instructions in mm, in the label's reading orientation (rotation for the
 * printer feed is applied by each output). Preview, PDF and ZPL draw exactly these.
 */
export type DrawOp =
  | {
      kind: 'text'
      x: number
      /** Top of the text cell; the cell is `size` mm high. */
      top: number
      w: number
      size: number
      text: string
      bold: boolean
      align: Align
      color: 'black' | 'white'
    }
  | { kind: 'fill'; x: number; y: number; w: number; h: number }
  | {
      kind: 'qr'
      x: number
      y: number
      size: number
      /** Module grid including the quiet zone; true = black. */
      modules: boolean[][]
    }
  | { kind: 'logo'; x: number; y: number; w: number; h: number; variant: LogoVariant }

export interface RenderedLabel {
  widthMm: number
  heightMm: number
  orientation: LabelDesign['orientation']
  ops: DrawOp[]
  qrText: string
}

export interface RenderOptions {
  /** Adds the REPRINT mark. */
  reprint?: boolean
  formatter?: QrFormatter
}

const caption = (lang: 'en' | 'nl' | 'none', en: string, nl: string) => (lang === 'en' ? en : lang === 'nl' ? nl : null)
const withCaption = (cap: string | null, value: string) => (cap ? `${cap}: ${value}` : value)

/** The text an element prints for this box. Empty when the box has no value for the field. */
export function elementText(el: TextLikeElement, d: LabelData): string {
  switch (el.type) {
    case 'field': {
      const def = fieldDef(el.field)
      const value = def?.value(d) ?? ''
      return value ? withCaption(caption(el.caption, def!.en, def!.nl), value) : ''
    }
    case 'text':
      return el.text
    case 'box_id':
      return withCaption(caption(el.caption, 'Box ID', 'Doos-ID'), formatBoxId(d.boxId))
    case 'box_count': {
      if (el.style === 'numbers') {
        const digits = String(d.boxTotal).length
        return `${String(d.boxNo).padStart(digits, '0')} / ${d.boxTotal}`
      }
      return el.caption === 'nl' ? `Doos ${d.boxNo} van ${d.boxTotal}` : `Box ${d.boxNo} of ${d.boxTotal}`
    }
  }
}

/** QR module grid (with quiet zone) for a text, using the formatter's error correction level. */
export function qrModules(text: string, errorCorrection: QrFormatter['errorCorrection']): boolean[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: errorCorrection })
  const n = qr.modules.size
  const q = QR_QUIET_MODULES
  return Array.from({ length: n + 2 * q }, (_, r) =>
    Array.from({ length: n + 2 * q }, (_, c) => {
      const rr = r - q
      const cc = c - q
      return rr >= 0 && cc >= 0 && rr < n && cc < n && qr.modules.get(rr, cc) === 1
    }),
  )
}

export function textOp(el: { x: number; y: number; w: number; h: number }, raw: string, fontPt: number, bold: boolean, align: Align, color: 'black' | 'white' = 'black'): DrawOp | null {
  const text = printableText(raw, bold)
  if (!text.trim()) return null
  const fit = fitText(text, ptToMm(fontPt), bold, el.w)
  if (!fit.text) return null
  return { kind: 'text', x: el.x, top: el.y + Math.max(0, (el.h - fit.sizeMm) / 2), w: el.w, size: fit.sizeMm, text: fit.text, bold, align, color }
}

/** Where the REPRINT mark goes when a layout doesn't say: the top-right corner. */
export function defaultReprintBox(widthMm: number): Omit<ReprintElement, 'id' | 'type'> {
  const w = Math.min(28, widthMm - 4)
  return { x: widthMm - w - 2, y: 2, w, h: 6 }
}

export function renderLabel(design: LabelDesign, data: LabelData, opts: RenderOptions = {}): RenderedLabel {
  const formatter = opts.formatter ?? ACTIVE_QR_FORMATTER
  const qrText = formatter.format(data)
  const ops: DrawOp[] = []
  const byType = (t: LabelElement['type']) => design.layout.elements.filter((e) => e.type === t)

  for (const el of byType('logo')) {
    if (el.type !== 'logo') continue
    const aspect = LOGO_ASPECT[el.variant]
    const w = Math.min(el.w, el.h * aspect)
    const h = w / aspect
    ops.push({ kind: 'logo', variant: el.variant, x: el.x + (el.w - w) / 2, y: el.y + (el.h - h) / 2, w, h })
  }

  for (const el of design.layout.elements) {
    if (!isTextLike(el)) continue
    const op = textOp(el, elementText(el, data), el.fontPt, el.bold, el.align)
    if (op) ops.push(op)
  }

  for (const el of byType('qr')) {
    const size = Math.min(el.w, el.h)
    ops.push({
      kind: 'qr',
      x: el.x + (el.w - size) / 2,
      y: el.y + (el.h - size) / 2,
      size,
      modules: qrModules(qrText, formatter.errorCorrection),
    })
  }

  if (opts.reprint) {
    const box = byType('reprint')[0] ?? defaultReprintBox(design.widthMm)
    ops.push({ kind: 'fill', x: box.x, y: box.y, w: box.w, h: box.h })
    const text = textOp({ x: box.x + 1, y: box.y, w: box.w - 2, h: box.h }, 'REPRINT', (box.h * 0.6) / ptToMm(1), true, 'center', 'white')
    if (text) ops.push(text)
  }

  return { widthMm: design.widthMm, heightMm: design.heightMm, orientation: design.orientation, ops, qrText }
}
