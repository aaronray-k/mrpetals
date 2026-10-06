/**
 * What goes inside a box label's QR code.
 *
 * Florisoft's QR data specification is still pending, so labels use a
 * ConsolFlora placeholder format for now. To switch, add a formatter for the
 * Florisoft spec below and point ACTIVE_QR_FORMATTER at it: the designer,
 * PDF, ZPL and the QC scanner (item 4) all go through this one object.
 */

export interface QrBoxData {
  boxId: number
  shipmentRef: string
  boxNo: number
  boxTotal: number
  farmCode: string
  customerCode: string
  productCode: string
  vbnCode: string | null
  stemsPerBox: number
}

export interface QrFormatter {
  id: string
  /** Shown to Admins in the designer. */
  name: string
  errorCorrection: 'L' | 'M' | 'Q' | 'H'
  format: (box: QrBoxData) => string
  /** Reads a scanned code back. Returns null if the code isn't one of ours. */
  parse: (text: string) => { boxId: number } | null
}

/** Placeholder: CF1|<box id>|<shipment ref>|<n>/<N> */
export const placeholderQrFormatter: QrFormatter = {
  id: 'consolflora-placeholder-v1',
  name: 'ConsolFlora placeholder (until the Florisoft specification arrives)',
  errorCorrection: 'M',
  format: (b) => `CF1|${b.boxId}|${b.shipmentRef}|${b.boxNo}/${b.boxTotal}`,
  parse: (text) => {
    const m = /^CF1\|(\d{1,15})\|[^|]*\|\d+\/\d+$/.exec(text.trim())
    return m ? { boxId: Number(m[1]) } : null
  },
}

export const ACTIVE_QR_FORMATTER: QrFormatter = placeholderQrFormatter
