import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Printer, Send, Truck, XCircle } from 'lucide-react'
import type { Box, PurchaseOrder } from '~/lib/orders/api'
import { Badge } from '~/components/ui/badge'

/** Every status shows an icon and words, never colour alone. */
export function PoStatus({ status }: { status: PurchaseOrder['status'] }) {
  switch (status) {
    case 'draft':
      return (
        <Badge>
          <CircleDashed aria-hidden="true" /> Draft
        </Badge>
      )
    case 'sent':
      return (
        <Badge variant="warning">
          <Send aria-hidden="true" /> Waiting for farm
        </Badge>
      )
    case 'confirmed':
      return (
        <Badge variant="success">
          <CheckCircle2 aria-hidden="true" /> Confirmed
        </Badge>
      )
    case 'declined':
      return (
        <Badge variant="destructive">
          <XCircle aria-hidden="true" /> Declined
        </Badge>
      )
  }
}

export function ReceivedStatus({ box }: { box: Pick<Box, 'received_at' | 'status'> }) {
  if (box.status === 'void') return <span className="text-muted-foreground">—</span>
  return box.received_at ? (
    <span className="inline-flex items-center gap-1 text-success">
      <Truck className="size-4" aria-hidden="true" /> Received
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Clock className="size-4" aria-hidden="true" /> Not yet
    </span>
  )
}

export function QcStatus({ box }: { box: Pick<Box, 'qc_status' | 'qc_note' | 'status'> }) {
  if (box.status === 'void') return <span className="text-muted-foreground">—</span>
  if (box.qc_status === 'passed')
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <CheckCircle2 className="size-4" aria-hidden="true" /> Passed
      </span>
    )
  if (box.qc_status === 'failed')
    return (
      <span className="inline-flex items-start gap-1 text-destructive" title={box.qc_note ?? undefined}>
        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Failed{box.qc_note ? `: ${box.qc_note}` : ''}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Clock className="size-4" aria-hidden="true" /> Pending
    </span>
  )
}

export function LabelStatus({ box }: { box: Pick<Box, 'last_printed_at' | 'last_print_kind' | 'label_out_of_date' | 'status'> }) {
  if (box.status === 'void') return <span className="text-muted-foreground">—</span>
  if (!box.last_printed_at) return <span className="text-muted-foreground">Not printed</span>
  if (box.label_out_of_date)
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-warning">
        <AlertTriangle className="size-4" aria-hidden="true" /> Reprint: numbers changed
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-success">
      <Printer className="size-4" aria-hidden="true" /> {box.last_print_kind === 'reprint' ? 'Reprinted' : 'Printed'}
    </span>
  )
}

/** "042 / 180": the number padded to the width of the total, like the paper packing lists. */
export function boxNumber(n: number | null, total: number | null) {
  if (n == null || total == null) return '—'
  return `${String(n).padStart(String(total).length, '0')} / ${total}`
}
