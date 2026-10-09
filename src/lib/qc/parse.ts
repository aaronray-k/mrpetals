import { ACTIVE_QR_FORMATTER, type QrRead } from '~/lib/labels/qr-format'

/**
 * What QC scanned or typed: a box label's QR code (read by the active QR formatter, so it follows
 * the Florisoft switch) or a plain 8-digit box id from the label.
 */
export function parseScan(text: string): QrRead | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'Scan a box label, or type the box id.' }
  const fromQr = ACTIVE_QR_FORMATTER.parse(t)
  if (fromQr) return fromQr
  const digits = t.replace(/\s+/g, '')
  if (/^\d{8}$/.test(digits)) return { boxId: Number(digits) }
  return { error: `"${t.length > 40 ? `${t.slice(0, 40)}…` : t}" is not a ConsolFlora box label. Box ids have 8 digits.` }
}
