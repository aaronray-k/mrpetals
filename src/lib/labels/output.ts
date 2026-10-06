import { downloadBlob } from '~/lib/download'
import type { RenderedLabel } from './engine'
import { loadLogos, logoBitmapProvider } from './logo-assets'
import type { Dpi } from './units'
import { labelsToZpl } from './zpl'

/** PDF of the labels, one page each. pdf-lib is only loaded when someone asks for a PDF. */
export async function downloadLabelsPdf(labels: RenderedLabel[], fileName: string) {
  const [{ labelsToPdf }, logos] = await Promise.all([import('./pdf'), loadLogos()])
  const bytes = await labelsToPdf(labels, logos.pngs)
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), fileName)
}

/** ZPL file for Zebra printers. */
export async function downloadLabelsZpl(labels: RenderedLabel[], dpi: Dpi, fileName: string) {
  const logos = await loadLogos()
  const zpl = labelsToZpl(labels, { dpi, logoBitmap: logoBitmapProvider(logos.images) })
  downloadBlob(new Blob([zpl], { type: 'application/zpl' }), fileName)
}
