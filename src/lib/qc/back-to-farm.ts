import type { LabelData } from '~/lib/labels/data'
import { formatBoxId } from '~/lib/labels/data'
import { qrModules, textOp, type DrawOp, type RenderedLabel } from '~/lib/labels/engine'
import type { Orientation } from '~/lib/labels/layout'
import { ACTIVE_QR_FORMATTER } from '~/lib/labels/qr-format'
import { PT_PER_MM } from '~/lib/labels/units'
import { textWidthEm } from '~/lib/labels/text-fit'

export interface StickerInput {
  data: LabelData
  reasons: string[]
  note: string | null
  qcBy: string | null
  qcAt: string | null
  widthMm: number
  heightMm: number
  orientation: Orientation
}

const M = 3
const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' }).format(new Date(iso)) : ''

/**
 * The BACK TO FARM sticker for a box QC rejected: a black banner, the farm, PO, box and product,
 * the reasons, and who checked it. Same size as the buyer's box label, so it prints on the same roll.
 */
export function backToFarmSticker(s: StickerInput): RenderedLabel {
  const W = s.widthMm
  const H = s.heightMm
  const ops: DrawOp[] = []
  const d = s.data

  // Banner
  const bh = Math.max(10, H * (W >= H ? 0.24 : 0.16))
  ops.push({ kind: 'fill', x: 0, y: 0, w: W, h: bh })
  const bannerSize = Math.min(bh * 0.62, (W - 2 * M) / textWidthEm('BACK TO FARM', true))
  const banner = textOp({ x: M, y: 0, w: W - 2 * M, h: bh }, 'BACK TO FARM', bannerSize * PT_PER_MM, true, 'center', 'white')
  if (banner) ops.push(banner)

  // QR (identifies the box if scanned again) on the right.
  const q = Math.min(H - bh - 2 * M - 6, W * 0.3)
  const qrText = ACTIVE_QR_FORMATTER.format({ ...d, boxNo: 0, boxTotal: 0 })
  ops.push({ kind: 'qr', x: W - M - q, y: bh + M, size: q, modules: qrModules(qrText, ACTIVE_QR_FORMATTER.errorCorrection) })
  const idOp = textOp({ x: W - M - q, y: bh + M + q, w: q, h: 5 }, formatBoxId(d.boxId), 9, true, 'center')
  if (idOp) ops.push(idOp)

  // Text column
  const reasons = s.reasons.length ? s.reasons.join(', ') : 'See QC note'
  const lines: { text: string; weight: number; bold: boolean }[] = [
    { text: d.farmName, weight: 1.5, bold: true },
    { text: `${d.poNumber ?? 'PO —'} · Box ID ${formatBoxId(d.boxId)}`, weight: 1, bold: false },
    { text: `${d.variety} · ${d.stemLengthCm} cm · ${d.grade} · ${d.stemsPerBox} stems`, weight: 1, bold: false },
    { text: `Reason: ${reasons}`, weight: 1.15, bold: true },
    ...(s.note ? [{ text: `Note: ${s.note}`, weight: 1, bold: false }] : []),
    { text: `QC: ${[s.qcBy, fmtDate(s.qcAt)].filter(Boolean).join(' · ')}`, weight: 0.9, bold: false },
    { text: `Shipment ${d.shipmentRef} · ${d.customerCode}`, weight: 0.9, bold: false },
  ]
  const x = M
  const w = W - q - 3 * M
  const total = lines.reduce((sum, l) => sum + l.weight, 0)
  const unit = (H - bh - 2 * M) / total
  let y = bh + M
  for (const l of lines) {
    const h = unit * l.weight
    const op = textOp({ x, y, w, h }, l.text, h * 0.72 * PT_PER_MM, l.bold, 'left')
    if (op) ops.push(op)
    y += h
  }
  return { widthMm: W, heightMm: H, orientation: s.orientation, ops, qrText }
}
