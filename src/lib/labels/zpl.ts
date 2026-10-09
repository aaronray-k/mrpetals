import { qrBitmap, rotateCW, toZplGraphic, type MonoBitmap } from './bitmap'
import type { DrawOp, RenderedLabel } from './engine'
import type { LogoVariant } from './layout'
import { dotsPerMm, type Dpi } from './units'

export interface ZplOptions {
  dpi: Dpi
  /** Black-and-white logo at exactly this size in dots. Needed when a label shows the logo. */
  logoBitmap?: (variant: LogoVariant, widthDots: number, heightDots: number) => MonoBitmap
}

/**
 * Zebra's scalable font (font 0) is narrower than Helvetica, so text that fits in the
 * preview always fits on the label. This widens it a little to look closer to the preview.
 */
export const ZEBRA_FONT_WIDTH = 1.0

const JUSTIFY = { left: 'L', center: 'C', right: 'R' } as const

/** Field data after ^FH_: escape the characters ZPL treats as commands. Backslash is ^FB's escape. */
export function zplText(text: string) {
  return text.replace(/_/g, '_5F').replace(/\^/g, '_5E').replace(/~/g, '_7E').replace(/\\/g, '\\\\')
}

/**
 * One ZPL document for any number of labels. Logos are sent to the printer once
 * (~DG) and recalled per label (^XG), then deleted at the end.
 */
export function labelsToZpl(labels: RenderedLabel[], opts: ZplOptions): string {
  const dpmm = dotsPerMm(opts.dpi)
  const d = (mm: number) => Math.round(mm * dpmm)
  const boldOffset = opts.dpi >= 300 ? 2 : 1
  const graphics = new Map<string, string>()
  const header: string[] = []
  const body: string[] = []

  for (const label of labels) {
    const W = d(label.widthMm)
    const H = d(label.heightMm)
    const rotated = label.orientation === 'rotated'
    // Rotated feed: the label goes through the printer sideways, turned 90° clockwise.
    const place = (x: number, y: number, w: number, h: number) =>
      rotated ? { X: H - (y + h), Y: x, w: h, h: w } : { X: x, Y: y, w, h }
    const graphic = (bm: MonoBitmap) => toZplGraphic(rotated ? rotateCW(bm) : bm)

    const lines = ['^XA', '^CI28', `^PW${rotated ? H : W}`, `^LL${rotated ? W : H}`, '^LH0,0']
    for (const op of label.ops) lines.push(...drawOp(op))
    lines.push('^PQ1', '^XZ')
    body.push(lines.join('\n'))

    function drawOp(op: DrawOp): string[] {
      switch (op.kind) {
        case 'logo': {
          const w = d(op.w)
          const h = d(op.h)
          if (!opts.logoBitmap || w < 1 || h < 1) return []
          const key = `${op.variant}:${w}x${h}:${rotated ? 'r' : 'n'}`
          let name = graphics.get(key)
          if (!name) {
            name = `CFLG${graphics.size + 1}`
            const g = graphic(opts.logoBitmap(op.variant, w, h))
            header.push(`~DGR:${name}.GRF,${g.totalBytes},${g.bytesPerRow},${g.data}`)
            graphics.set(key, name)
          }
          const p = place(d(op.x), d(op.y), w, h)
          return [`^FO${p.X},${p.Y}^XGR:${name}.GRF,1,1^FS`]
        }
        case 'fill': {
          const p = place(d(op.x), d(op.y), d(op.w), d(op.h))
          return [`^FO${p.X},${p.Y}^GB${p.w},${p.h},${Math.min(p.w, p.h)},B,0^FS`]
        }
        case 'qr': {
          const size = d(op.size)
          const n = op.modules.length
          // Whole dots per module, so every module prints the same size; the code is centred in its box.
          const m = Math.max(1, Math.floor(size / n))
          const off = Math.floor((size - m * n) / 2)
          const g = graphic(qrBitmap(op.modules, m))
          const p = place(d(op.x) + off, d(op.y) + off, m * n, m * n)
          return [`^FO${p.X},${p.Y}^GFA,${g.totalBytes},${g.totalBytes},${g.bytesPerRow},${g.data}^FS`]
        }
        case 'text': {
          const h = Math.max(1, d(op.size))
          const w = d(op.w)
          const font = `^A0${rotated ? 'R' : 'N'},${h},${Math.max(1, Math.round(h * ZEBRA_FONT_WIDTH))}`
          const field = (dx: number) => {
            const p = place(d(op.x) + dx, d(op.top), w, h)
            return `^FO${p.X},${p.Y}${font}^FB${w},1,0,${JUSTIFY[op.align]}${op.color === 'white' ? '^FR' : ''}^FH_^FD${zplText(op.text)}^FS`
          }
          // Font 0 has one weight: bold is printed twice, a dot apart. Not for reversed (white)
          // text: reverse mode flips pixels, so a second pass would cancel the first.
          return op.bold && op.color === 'black' ? [field(0), field(boldOffset)] : [field(0)]
        }
      }
    }
  }

  const cleanup = graphics.size ? ['^XA^IDR:CFLG*.GRF^FS^XZ'] : []
  return [...header, ...body, ...cleanup].join('\n') + '\n'
}
