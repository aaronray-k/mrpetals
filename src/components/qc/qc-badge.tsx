import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, Info, Undo2 } from 'lucide-react'
import type { QcReason } from '~/lib/qc/api'
import { Badge } from '~/components/ui/badge'

type QcState = { status: 'active' | 'void' | 'back_to_farm'; qc_status: 'pending' | 'passed' | 'failed'; qc_severity: 'minor' | 'major' | 'critical' | null }

/** QC result as words and an icon (never colour alone): Pending, Passed, Minor, Major, Back to farm. */
export function QcBadge({ box }: { box: QcState }) {
  if (box.status === 'back_to_farm' || box.qc_severity === 'critical')
    return (
      <Badge variant="destructive" className="bg-destructive text-white">
        <Undo2 aria-hidden="true" /> Critical: back to farm
      </Badge>
    )
  if (box.qc_status === 'failed')
    return (
      <Badge variant="destructive">
        <AlertOctagon aria-hidden="true" /> Major: failed
      </Badge>
    )
  if (box.qc_status === 'passed' && box.qc_severity === 'minor')
    return (
      <Badge variant="warning">
        <Info aria-hidden="true" /> Minor: passed
      </Badge>
    )
  if (box.qc_status === 'passed')
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden="true" /> Passed
      </Badge>
    )
  return (
    <Badge>
      <Clock aria-hidden="true" /> QC pending
    </Badge>
  )
}

export const SEVERITIES = [
  { id: 'minor', label: 'Minor', icon: Info, help: 'The box passes. The reason is recorded for the farm.' },
  { id: 'major', label: 'Major', icon: AlertTriangle, help: 'The box fails. Fix it here, then a Senior QC checks it again.' },
  { id: 'critical', label: 'Critical: BACK TO FARM', icon: Undo2, help: 'The box leaves the shipment and goes back to the farm with a sticker.' },
] as const

export const reasonLabels = (codes: string[], reasons: QcReason[] | undefined) =>
  codes.map((c) => reasons?.find((r) => r.code === c)?.label ?? c)
