import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { toLabelData } from '~/lib/orders/print-boxes'
import { downloadLabelsPdf, downloadLabelsZpl } from '~/lib/labels/output'
import type { PrintFormat } from '~/lib/orders/print-boxes'
import type { Orientation } from '~/lib/labels/layout'
import { backToFarmSticker } from './back-to-farm'
import type { SendOutcome } from './queue'

export type QcResult = 'pass' | 'minor' | 'major' | 'critical'

export interface QcReason {
  code: string
  label: string
  critical_only: boolean
  needs_note: boolean
}

/** A box as QC sees it after a scan (qc_box_summary in the database). */
export interface ScannedBox {
  box_id: number
  status: 'active' | 'void' | 'back_to_farm'
  shipment_id: string
  shipment_ref: string
  buyer_box_no: number | null
  buyer_box_total: number | null
  farm_box_no: number | null
  farm_box_total: number | null
  customer_name: string
  customer_code: string
  farm_name: string
  variety: string
  flower_type: string
  stem_length_cm: number
  grade: string
  stems: number
  received_at: string | null
  qc_status: 'pending' | 'passed' | 'failed'
  qc_severity: 'minor' | 'major' | 'critical' | null
  qc_reasons: string[]
  qc_note: string | null
  scanned_before?: boolean
  first_scanned_at?: string | null
}

export function useQcReasons() {
  return useQuery({
    queryKey: ['qc-reasons'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('qc_reasons').select('code, label, critical_only, needs_note').eq('active', true).order('sort_order')
      if (error) throw new Error(error.message)
      return data as QcReason[]
    },
    staleTime: 10 * 60_000,
  })
}

/**
 * Calls a database function and says whether a failure was the connection (try again later) or
 * the database refusing (show the message). Postgrest reports a lost connection as status 0.
 */
async function call<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; retry: boolean; message: string }> {
  try {
    const { data, error, status } = await getSupabase().rpc(fn, args)
    if (!error) return { ok: true, data: data as T }
    return { ok: false, retry: status === 0 || status >= 500, message: error.message }
  } catch (e) {
    return { ok: false, retry: true, message: (e as Error).message }
  }
}

export const qcScan = (eventId: string, shipmentId: string, boxId: number, scannedAt: string) =>
  call<ScannedBox>('qc_scan', { p_event_id: eventId, p_shipment_id: shipmentId, p_box_id: boxId, p_scanned_at: scannedAt })

export const qcRecord = (eventId: string, boxIds: number[], result: QcResult, reasons: string[], note: string | null, at: string) =>
  call<number>('qc_record', { p_event_id: eventId, p_box_ids: boxIds, p_result: result, p_reasons: reasons, p_note: note, p_happened_at: at })

/** Shrinks a photo to at most 1600 px as JPEG, so it uploads quickly over mobile data. */
export async function compressPhoto(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.8))
  } catch {
    return file
  }
}

/** Uploads a QC photo for a box. */
export async function uploadQcPhoto(boxId: number, photo: Blob, fileId: string): Promise<SendOutcome> {
  const path = `${boxId}/${fileId}.jpg`
  const supabase = getSupabase()
  try {
    const up = await supabase.storage.from('qc-photos').upload(path, photo, { contentType: 'image/jpeg', upsert: true })
    if (up.error) {
      const status = Number((up.error as { statusCode?: string | number }).statusCode ?? 0)
      return status === 0 || status >= 500 ? { status: 'retry' } : { status: 'refused', message: up.error.message }
    }
    const { error, status } = await supabase.from('qc_photos').insert({ box_id: boxId, storage_path: path })
    if (error && error.code !== '23505') return status === 0 ? { status: 'retry' } : { status: 'refused', message: error.message }
    return { status: 'sent' }
  } catch {
    return { status: 'retry' }
  }
}

export interface QcPhoto {
  id: string
  storage_path: string
  taken_at: string
}

/** A box's photos, as object URLs for <img>. */
export function useBoxPhotos(boxId: number | null) {
  return useQuery({
    queryKey: ['qc-photos', boxId],
    enabled: boxId != null,
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase.from('qc_photos').select('id, storage_path, taken_at').eq('box_id', boxId!).order('taken_at')
      if (error) throw new Error(error.message)
      return Promise.all(
        (data as QcPhoto[]).map(async (p) => {
          const file = await supabase.storage.from('qc-photos').download(p.storage_path)
          return { ...p, url: file.data ? URL.createObjectURL(file.data) : null }
        }),
      )
    },
  })
}

/** Prints the BACK TO FARM sticker for a box (logged in the database). */
export async function printBackToFarmSticker(boxId: number, format: PrintFormat) {
  const { data, error } = await getSupabase().rpc('back_to_farm_sticker', { p_box_id: boxId })
  if (error) throw new Error(error.message)
  const r = data as {
    data: Record<string, unknown>
    reasons: string[]
    note: string | null
    qc_by: string | null
    qc_at: string | null
    width_mm: number
    height_mm: number
    orientation: Orientation
  }
  const sticker = backToFarmSticker({
    data: toLabelData(r.data),
    reasons: r.reasons,
    note: r.note,
    qcBy: r.qc_by,
    qcAt: r.qc_at,
    widthMm: Number(r.width_mm),
    heightMm: Number(r.height_mm),
    orientation: r.orientation,
  })
  const name = `back-to-farm-${boxId}`
  if (format.kind === 'pdf') await downloadLabelsPdf([sticker], `${name}.pdf`)
  else await downloadLabelsZpl([sticker], format.dpi, `${name}-${format.dpi}dpi.zpl`)
}

export interface ReturnedBox {
  id: number
  stems: number
  qc_reasons: string[]
  qc_note: string | null
  qc_at: string | null
  products: { variety: string; flower_type: string; stem_length_cm: number; grade: string } | null
  purchase_order_lines: { purchase_orders: { po_number: string } | null } | null
}

/** Boxes QC sent back to the signed-in farm, newest first, with their photo counts. */
export function useReturnedBoxes() {
  return useQuery({
    queryKey: ['returned-boxes'],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('boxes')
        .select('id, stems, qc_reasons, qc_note, qc_at, products(variety, flower_type, stem_length_cm, grade), purchase_order_lines(purchase_orders(po_number))')
        .eq('status', 'back_to_farm')
        .order('qc_at', { ascending: false })
      if (error) throw new Error(error.message)
      const boxes = (data as unknown as ReturnedBox[]).map((b) => ({ ...b, id: Number(b.id) }))
      const ids = boxes.map((b) => b.id)
      const photos = ids.length ? await supabase.from('qc_photos').select('box_id').in('box_id', ids) : { data: [] as { box_id: number }[] }
      return boxes.map((b) => ({ ...b, photo_count: (photos.data ?? []).filter((p) => Number(p.box_id) === b.id).length }))
    },
  })
}
