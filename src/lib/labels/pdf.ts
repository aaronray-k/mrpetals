import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage } from 'pdf-lib'
import { TEXT_ASCENT, type RenderedLabel } from './engine'
import type { LogoVariant } from './layout'
import { PT_PER_MM } from './units'

/**
 * One PDF page per label, at the label's real size. Rotated-feed labels get a
 * 90° page rotation, so the page comes out of a 4-inch printer the same way
 * as the ZPL version.
 */
export async function labelsToPdf(
  labels: RenderedLabel[],
  logoPngs: Partial<Record<LogoVariant, Uint8Array | ArrayBuffer>> = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('ConsolFlora box labels')
  doc.setCreator('ConsolFlora')
  doc.setProducer('ConsolFlora')
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const images = new Map<LogoVariant, PDFImage>()
  const black = rgb(0, 0, 0)
  const white = rgb(1, 1, 1)

  for (const label of labels) {
    const H = label.heightMm
    const page = doc.addPage([label.widthMm * PT_PER_MM, H * PT_PER_MM])
    if (label.orientation === 'rotated') page.setRotation(degrees(90))
    const pt = (mm: number) => mm * PT_PER_MM
    // PDF measures up from the bottom; the label layout measures down from the top.
    const fromTop = (mm: number) => pt(H - mm)

    for (const op of label.ops) {
      switch (op.kind) {
        case 'logo': {
          const png = logoPngs[op.variant]
          if (!png) break
          let image = images.get(op.variant)
          if (!image) {
            image = await doc.embedPng(png)
            images.set(op.variant, image)
          }
          page.drawImage(image, { x: pt(op.x), y: fromTop(op.y + op.h), width: pt(op.w), height: pt(op.h) })
          break
        }
        case 'fill':
          page.drawRectangle({ x: pt(op.x), y: fromTop(op.y + op.h), width: pt(op.w), height: pt(op.h), color: black })
          break
        case 'qr': {
          // One path for all modules: no hairline gaps between neighbouring squares.
          const m = op.size / op.modules.length
          let path = ''
          op.modules.forEach((row, r) => {
            for (let c = 0; c < row.length; c++) {
              if (!row[c]) continue
              let end = c
              while (end + 1 < row.length && row[end + 1]) end++
              path += `M${c * m} ${r * m}h${(end - c + 1) * m}v${m}h${-(end - c + 1) * m}z`
              c = end
            }
          })
          page.drawSvgPath(path, { x: pt(op.x), y: fromTop(op.y), scale: PT_PER_MM, color: black, borderWidth: 0 })
          break
        }
        case 'text': {
          const font: PDFFont = op.bold ? bold : regular
          const size = pt(op.size)
          const width = font.widthOfTextAtSize(op.text, size)
          const x = op.align === 'left' ? pt(op.x) : op.align === 'center' ? pt(op.x + op.w / 2) - width / 2 : pt(op.x + op.w) - width
          page.drawText(op.text, { x, y: fromTop(op.top + op.size * TEXT_ASCENT), size, font, color: op.color === 'white' ? white : black })
          break
        }
      }
    }
  }
  return doc.save()
}
