/**
 * What goes inside a box label's QR code.
 *
 * Florisoft's QR data specification is still pending, so labels use a ConsolFlora format for now,
 * carrying the Floricode codes a buyer's system needs to book the box in. To switch, add a formatter
 * for the Florisoft spec below and point ACTIVE_QR_FORMATTER at it: the designer, PDF, ZPL and the
 * QC scanner all go through this one object.
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
  floricodeFeatures: Record<string, string>
  vbnPackagingCode: string | null
  growerGln: string | null
}

export interface QrRead {
  boxId: number
  /** The Floricode codes in the QR code (CF2 labels only), e.g. { VBN: '13000', S20: '070', PKG: '901' }. */
  codes?: Record<string, string>
}

export interface QrFormatter {
  id: string
  /** Shown to Admins in the designer. */
  name: string
  errorCorrection: 'L' | 'M' | 'Q' | 'H'
  format: (box: QrBoxData) => string
  /** Reads a scanned code back. Returns null if the code isn't one of ours. */
  parse: (text: string) => QrRead | null
}

/** First labels: CF1|<box id>|<shipment ref>|<n>/<N>. Still read, so boxes already labelled scan. */
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

const safe = (v: string) => v.replace(/[|:\r\n]/g, '/')

/**
 * CF2|<box id>|<shipment ref>|<n>/<N>|VBN:<code>|<feature>:<value>…|PKG:<packaging>|GLN:<grower>|Q:<stems>
 * Floricode feature codes keep their own codes (S20 stem length, Q01 quality group, …); empty values are left out.
 */
export const floricodeQrFormatter: QrFormatter = {
  id: 'consolflora-floricode-v2',
  name: 'ConsolFlora with Floricode codes (until the Florisoft specification arrives)',
  errorCorrection: 'M',
  format: (b) => {
    const pairs: [string, string | null][] = [
      ['VBN', b.vbnCode],
      ...Object.keys(b.floricodeFeatures)
        .sort()
        .map((k): [string, string] => [k, b.floricodeFeatures[k]!]),
      ['PKG', b.vbnPackagingCode],
      ['GLN', b.growerGln],
      ['Q', b.stemsPerBox ? String(b.stemsPerBox) : null],
    ]
    return [
      'CF2',
      String(b.boxId),
      safe(b.shipmentRef),
      `${b.boxNo}/${b.boxTotal}`,
      ...pairs.filter(([k, v]) => /^[A-Z0-9]{1,5}$/.test(k) && v != null && v !== '').map(([k, v]) => `${k}:${safe(v!)}`),
    ].join('|')
  },
  parse: (text) => {
    const t = text.trim()
    const m = /^CF2\|(\d{1,15})\|[^|]*\|\d+\/\d+((?:\|[A-Z0-9]{1,5}:[^|:]*)*)$/.exec(t)
    if (!m) return placeholderQrFormatter.parse(t)
    const codes = Object.fromEntries(
      m[2]!
        .split('|')
        .filter(Boolean)
        .map((p) => p.split(':') as [string, string]),
    )
    return { boxId: Number(m[1]), codes }
  },
}

export const ACTIVE_QR_FORMATTER: QrFormatter = floricodeQrFormatter
