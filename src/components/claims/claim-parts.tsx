import { Ban, CheckCircle2, CircleDashed, Clock, FileCheck2, MessageCircleQuestion, Undo2 } from 'lucide-react'
import { DECISION_LABEL, NOTICE_STATUS_LABEL, type ClaimStatus, type Decision, type Notice, type Photo } from '~/lib/claims/api'
import { Badge } from '~/components/ui/badge'

/** Status in words with an icon, never colour alone. */
export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  if (status === 'submitted')
    return (
      <Badge variant="warning">
        <Clock aria-hidden="true" /> Being reviewed
      </Badge>
    )
  if (status === 'decided')
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden="true" /> Decided
      </Badge>
    )
  return (
    <Badge>
      <Undo2 aria-hidden="true" /> Withdrawn
    </Badge>
  )
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const Icon = decision === 'approved' ? CheckCircle2 : decision === 'denied' ? Ban : CircleDashed
  return (
    <Badge variant={decision === 'approved' ? 'success' : decision === 'denied' ? 'destructive' : 'warning'}>
      <Icon aria-hidden="true" /> {DECISION_LABEL[decision]}
    </Badge>
  )
}

export function NoticeStatusBadge({ status }: { status: Notice['status'] }) {
  const Icon = status === 'credited' || status === 'closed' ? FileCheck2 : status === 'queried' ? MessageCircleQuestion : Clock
  return (
    <Badge variant={status === 'sent' || status === 'queried' ? 'warning' : 'success'}>
      <Icon aria-hidden="true" /> {NOTICE_STATUS_LABEL[status]}
    </Badge>
  )
}

export function PhotoGrid({ photos, label }: { photos: Photo[]; label: string }) {
  if (!photos.length) return null
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {photos.map((p, i) =>
        p.url ? (
          <li key={p.id}>
            <a href={p.url} target="_blank" rel="noopener" className="block rounded-md border hover:opacity-90">
              <img src={p.url} alt={`${label}, photo ${i + 1} (opens full size)`} className="size-24 rounded-md object-cover" />
            </a>
          </li>
        ) : null,
      )}
    </ul>
  )
}
