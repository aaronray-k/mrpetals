import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { compressPhoto } from '~/lib/qc/api'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}
const num = (v: unknown) => (v == null ? null : Number(v))
/** A one-to-one embed comes back as an object (or null), a one-to-many one as a list. */
const list = <T,>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : [])

// ---------------------------------------------------------------------------
// Buyer: report a claim
// ---------------------------------------------------------------------------
export interface ClaimableBox {
  shipment_id: string
  shipment_ref: string
  flight_date: string
  deadline: string
  box_id: number
  buyer_box_no: number
  order_number: string
  product: string
  stems: number
  price_per_stem: number
  currency: string
}

export function useClaimableBoxes() {
  return useQuery({
    queryKey: ['claimable-boxes'],
    queryFn: async () => (await rpc<ClaimableBox[]>('claimable_boxes')).map((b) => ({ ...b, price_per_stem: Number(b.price_per_stem) })),
  })
}

export interface ClaimLineInput {
  box_id: number
  reason: string
  stems: number
  note: string
  photos: File[]
}

/** Submits the claim, then uploads each line's photos to it. */
export async function submitClaim(shipmentId: string, lines: ClaimLineInput[], costs: { description: string; amount: number }[], note: string) {
  const r = await rpc<{ claim_id: string; claim_number: string; lines: { id: string; box_id: number }[] }>('submit_claim', {
    p_shipment_id: shipmentId,
    p_lines: lines.map(({ box_id, reason, stems, note }) => ({ box_id, reason, stems, note })),
    p_costs: costs,
    p_note: note,
  })
  const failed: string[] = []
  for (const l of lines) {
    const lineId = r.lines.find((x) => x.box_id === l.box_id)?.id
    for (const file of l.photos) {
      try {
        await uploadClaimPhoto(r.claim_id, lineId ?? null, file)
      } catch {
        failed.push(file.name)
      }
    }
  }
  return { ...r, failedPhotos: failed }
}

export async function uploadClaimPhoto(claimId: string, lineId: string | null, file: File) {
  const supabase = getSupabase()
  const path = `${claimId}/${crypto.randomUUID()}.jpg`
  const up = await supabase.storage.from('claim-photos').upload(path, await compressPhoto(file), { contentType: 'image/jpeg' })
  if (up.error) throw new Error(up.error.message)
  const { error } = await supabase.from('claim_photos').insert({ claim_id: claimId, claim_line_id: lineId, storage_path: path })
  if (error) throw new Error(error.message)
}

export const withdrawClaim = (id: string) => rpc<void>('withdraw_claim', { p_claim_id: id })

// ---------------------------------------------------------------------------
// Claims (buyer: own; staff: all)
// ---------------------------------------------------------------------------
export type ClaimStatus = 'submitted' | 'decided' | 'withdrawn'
export type Decision = 'pending' | 'approved' | 'denied'

export interface ClaimRow {
  id: string
  claim_number: string
  customer_id: string
  shipment_id: string
  currency: string
  status: ClaimStatus
  note: string | null
  submitted_at: string
  decided_at: string | null
  decision_note: string | null
  customers: { company_name: string; customer_code: string } | null
  shipments: { shipment_ref: string; flight_date: string } | null
  claim_lines: { claimed_amount: number; approved_amount: number | null; decision: Decision }[]
  credit_notes: { credit_note_number: string; amount: number }[]
}

export function useClaims() {
  return useQuery({
    queryKey: ['claims'],
    queryFn: async () =>
      (
        await rows<ClaimRow>(
          getSupabase()
            .from('claims')
            .select('*, customers(company_name, customer_code), shipments(shipment_ref, flight_date), claim_lines(claimed_amount, approved_amount, decision), credit_notes(credit_note_number, amount)')
            .order('submitted_at', { ascending: false }),
        )
      ).map((c) => ({
        ...c,
        claim_lines: c.claim_lines.map((l) => ({ ...l, claimed_amount: Number(l.claimed_amount), approved_amount: num(l.approved_amount) })),
        credit_notes: list(c.credit_notes).map((n) => ({ ...n, amount: Number(n.amount) })),
      })),
  })
}

export interface ClaimLine {
  id: string
  line_no: number
  box_id: number
  reason: string
  stems: number
  note: string | null
  price_per_stem: number
  claimed_amount: number
  decision: Decision
  approved_stems: number | null
  approved_amount: number | null
  decision_note: string | null
}
export interface ClaimCost {
  id: string
  description: string
  amount: number
  decision: Decision
  approved_amount: number | null
  farm_id: string | null
  decision_note: string | null
}
export interface Photo {
  id: string
  claim_line_id: string | null
  url: string | null
}
export interface BoxQc {
  id: number
  status: 'active' | 'void' | 'back_to_farm'
  farm_id: string
  farm_name: string | null
  po_number: string | null
  qc_status: 'pending' | 'passed' | 'failed'
  qc_severity: 'minor' | 'major' | 'critical' | null
  qc_reasons: string[]
  qc_note: string | null
  photo_count: number
}
export interface Notice {
  id: string
  notice_number: string
  claim_id: string
  farm_id: string
  currency: string
  amount: number
  status: 'sent' | 'queried' | 'credited' | 'closed'
  sent_at: string
  credit_note_number: string | null
  credit_amount: number | null
  credit_issued_on: string | null
  credit_document_path: string | null
  farms?: { farm_name: string } | null
  farm_claim_notice_lines: { id: string; claim_line_id: string | null; box_id: number | null; po_number: string | null; product: string; reason: string; stems: number | null; price_per_stem: number | null; amount: number }[]
  farm_claim_messages: { id: string; author_side: 'farm' | 'consolflora'; body: string; created_at: string }[]
}

async function photoUrls(list: { id: string; claim_line_id: string | null; storage_path: string }[]) {
  const supabase = getSupabase()
  return Promise.all(
    list.map(async (p) => {
      const f = await supabase.storage.from('claim-photos').download(p.storage_path)
      return { id: p.id, claim_line_id: p.claim_line_id, url: f.data ? URL.createObjectURL(f.data) : null }
    }),
  )
}

const noticeSelect = '*, farms(farm_name), farm_claim_notice_lines(*), farm_claim_messages(*)'
const toNotice = (n: Notice): Notice => ({
  ...n,
  amount: Number(n.amount),
  credit_amount: num(n.credit_amount),
  farm_claim_notice_lines: n.farm_claim_notice_lines.map((l) => ({ ...l, amount: Number(l.amount), price_per_stem: num(l.price_per_stem) })),
  farm_claim_messages: [...n.farm_claim_messages].sort((a, b) => a.created_at.localeCompare(b.created_at)),
})

/** A claim with its lines, costs, photos, QC results (staff), credit note and farm notices (staff). */
export function useClaim(id: string, staff: boolean) {
  return useQuery({
    queryKey: ['claim', id],
    queryFn: async () => {
      const s = getSupabase()
      const claim = (await rows<ClaimRow>(s.from('claims').select('*, customers(company_name, customer_code), shipments(shipment_ref, flight_date), claim_lines(claimed_amount, approved_amount, decision), credit_notes(credit_note_number, amount)').eq('id', id)))[0]
      if (!claim) throw new Error('This claim doesn\'t exist, or isn\'t yours.')
      const [lines, costs, photos, notices] = await Promise.all([
        rows<ClaimLine>(s.from('claim_lines').select('*').eq('claim_id', id).order('line_no')),
        rows<ClaimCost>(s.from('claim_costs').select('*').eq('claim_id', id)),
        rows<{ id: string; claim_line_id: string | null; storage_path: string }>(s.from('claim_photos').select('id, claim_line_id, storage_path').eq('claim_id', id).order('uploaded_at')),
        staff ? rows<Notice>(s.from('farm_claim_notices').select(noticeSelect).eq('claim_id', id)) : Promise.resolve([] as Notice[]),
      ])
      const boxIds = lines.map((l) => l.box_id)
      const boxes: BoxQc[] = []
      if (staff && boxIds.length) {
        const [raw, qcPhotos] = await Promise.all([
          rows<{ id: number; status: BoxQc['status']; farm_id: string; qc_status: BoxQc['qc_status']; qc_severity: BoxQc['qc_severity']; qc_reasons: string[]; qc_note: string | null; farms: { farm_name: string } | null; purchase_order_lines: { purchase_orders: { po_number: string } | null } | null }>(
            s.from('boxes').select('id, status, farm_id, qc_status, qc_severity, qc_reasons, qc_note, farms(farm_name), purchase_order_lines(purchase_orders(po_number))').in('id', boxIds),
          ),
          rows<{ box_id: number }>(s.from('qc_photos').select('box_id').in('box_id', boxIds)),
        ])
        for (const b of raw)
          boxes.push({
            id: b.id, status: b.status, farm_id: b.farm_id, farm_name: b.farms?.farm_name ?? null, po_number: b.purchase_order_lines?.purchase_orders?.po_number ?? null,
            qc_status: b.qc_status, qc_severity: b.qc_severity, qc_reasons: b.qc_reasons, qc_note: b.qc_note,
            photo_count: qcPhotos.filter((p) => p.box_id === b.id).length,
          })
      }
      return {
        claim: { ...claim, credit_notes: list(claim.credit_notes).map((n) => ({ ...n, amount: Number(n.amount) })) },
        lines: lines.map((l) => ({ ...l, price_per_stem: Number(l.price_per_stem), claimed_amount: Number(l.claimed_amount), approved_amount: num(l.approved_amount) })),
        costs: costs.map((c) => ({ ...c, amount: Number(c.amount), approved_amount: num(c.approved_amount) })),
        photos: await photoUrls(photos),
        boxes,
        notices: notices.map(toNotice),
      }
    },
  })
}

export const decideClaimLine = (lineId: string, approve: boolean, stems: number | null, note: string) =>
  rpc<void>('decide_claim_line', { p_line_id: lineId, p_approve: approve, p_stems: stems, p_note: note })
export const decideClaimCost = (costId: string, approve: boolean, amount: number | null, farmId: string | null, note: string) =>
  rpc<void>('decide_claim_cost', { p_cost_id: costId, p_approve: approve, p_amount: amount, p_farm_id: farmId, p_note: note })
export const finishClaimReview = (claimId: string, note: string) =>
  rpc<{ credit_note: string | null; amount: number; notices: number }>('finish_claim_review', { p_claim_id: claimId, p_note: note })
export const closeNotice = (noticeId: string, note: string) => rpc<void>('close_claim_notice', { p_notice_id: noticeId, p_note: note })
export const noticeMessage = (noticeId: string, body: string) => rpc<void>('claim_notice_message', { p_notice_id: noticeId, p_body: body })

// ---------------------------------------------------------------------------
// Farm: claim notices
// ---------------------------------------------------------------------------
export function useFarmNotices() {
  return useQuery({
    queryKey: ['farm-notices'],
    queryFn: async () => (await rows<Notice>(getSupabase().from('farm_claim_notices').select(noticeSelect).order('sent_at', { ascending: false }))).map(toNotice),
  })
}

/** The photos a farm may see for its notice (only the lines on it). */
export function useNoticePhotos(notice: Notice) {
  return useQuery({
    queryKey: ['notice-photos', notice.id],
    queryFn: async () => {
      const ids = notice.farm_claim_notice_lines.map((l) => l.claim_line_id).filter(Boolean) as string[]
      if (!ids.length) return []
      return photoUrls(await rows(getSupabase().from('claim_photos').select('id, claim_line_id, storage_path').in('claim_line_id', ids)))
    },
  })
}

export async function farmSendCreditNote(notice: Notice, input: { number: string; amount: number; issuedOn: string; file: File | null; comment: string }) {
  let path: string | null = null
  if (input.file) {
    path = `${notice.id}/${crypto.randomUUID()}-${input.file.name.replace(/[^\w.-]/g, '_')}`
    const up = await getSupabase().storage.from('farm-credit-notes').upload(path, input.file, { contentType: input.file.type || 'application/pdf' })
    if (up.error) throw new Error(up.error.message)
  }
  await rpc<void>('farm_send_credit_note', {
    p_notice_id: notice.id,
    p_number: input.number,
    p_amount: input.amount,
    p_issued_on: input.issuedOn,
    p_document_path: path,
    p_comment: input.comment,
  })
}

export async function openCreditNoteDocument(path: string) {
  const { data, error } = await getSupabase().storage.from('farm-credit-notes').download(path)
  if (error || !data) throw new Error(error?.message ?? 'The document could not be opened.')
  window.open(URL.createObjectURL(data), '_blank', 'noopener')
}

export const DECISION_LABEL: Record<Decision, string> = { pending: 'To review', approved: 'Approved', denied: 'Denied' }
export const NOTICE_STATUS_LABEL: Record<Notice['status'], string> = { sent: 'Waiting for the farm', queried: 'Farm has a question', credited: 'Credit note received', closed: 'Closed' }
