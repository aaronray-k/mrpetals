import type { LabelData } from '~/lib/labels/data'
import { renderLabel } from '~/lib/labels/engine'
import { parseLayout } from '~/lib/labels/layout'
import { downloadLabelsPdf, downloadLabelsZpl } from '~/lib/labels/output'
import type { Dpi } from '~/lib/labels/units'
import { printLabelsRpc, type PrintRow } from './api'

export type PrintFormat = { kind: 'pdf' } | { kind: 'zpl'; dpi: Dpi }

const str = (v: unknown) => (v == null ? '' : String(v))
const optStr = (v: unknown) => (v == null || v === '' ? null : String(v))
const int = (v: unknown) => Math.trunc(Number(v ?? 0))
const optNum = (v: unknown) => (v == null || v === '' ? null : Number(v))

/** The database's box_label_data() JSON, as the label engine's LabelData. */
export function toLabelData(d: Record<string, unknown>): LabelData {
  return {
    boxId: int(d.boxId),
    boxNo: int(d.boxNo),
    boxTotal: int(d.boxTotal),
    farmBoxNo: int(d.farmBoxNo),
    farmBoxTotal: int(d.farmBoxTotal),
    shipmentRef: str(d.shipmentRef),
    mawb: optStr(d.mawb),
    hawb: optStr(d.hawb),
    poNumber: optStr(d.poNumber),
    customerCode: str(d.customerCode),
    customerName: str(d.customerName),
    destinationAirport: str(d.destinationAirport),
    destinationCountry: str(d.destinationCountry),
    farmCode: str(d.farmCode),
    farmName: str(d.farmName),
    originCountry: str(d.originCountry),
    originAirport: optStr(d.originAirport),
    productCode: str(d.productCode),
    flowerType: str(d.flowerType),
    variety: str(d.variety),
    colour: optStr(d.colour),
    grade: str(d.grade),
    stemLengthCm: int(d.stemLengthCm),
    headSizeCm: optNum(d.headSizeCm),
    maturity: optStr(d.maturity),
    vbnCode: optStr(d.vbnCode),
    stemsPerBunch: int(d.stemsPerBunch),
    bunchesPerBox: int(d.bunchesPerBox),
    stemsPerBox: int(d.stemsPerBox),
    boxCode: str(d.boxCode),
    boxDescription: optStr(d.boxDescription),
    grossWeightKg: optNum(d.grossWeightKg),
    packDate: str(d.packDate),
  }
}

/** Each printed box drawn with its buyer's template version; reprints get the REPRINT mark. */
export function renderPrintRows(rows: PrintRow[]) {
  return rows.map((r) =>
    renderLabel(
      { widthMm: Number(r.width_mm), heightMm: Number(r.height_mm), orientation: r.orientation, layout: parseLayout(r.layout) },
      toLabelData(r.data),
      { reprint: r.kind === 'reprint' },
    ),
  )
}

/**
 * Prints labels: the database checks each box may be printed (farm confirmed, received,
 * passed QC; a reason for reprints) and logs the print, then the file is downloaded.
 */
export async function printBoxLabels(ids: number[], reason: string | null, format: PrintFormat, fileBase: string) {
  const rows = await printLabelsRpc(ids, reason)
  const labels = renderPrintRows(rows)
  if (format.kind === 'pdf') await downloadLabelsPdf(labels, `${fileBase}.pdf`)
  else await downloadLabelsZpl(labels, format.dpi, `${fileBase}-${format.dpi}dpi.zpl`)
  return { count: rows.length, reprints: rows.filter((r) => r.kind === 'reprint').length }
}
