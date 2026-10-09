import { Ban, CheckCircle2 } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import type { CodeStatus } from '~/lib/floricode/api'

/** Active or blocked, always in words with an icon, never colour alone. */
export function CodeStatusBadge({ status, replacedBy }: { status: CodeStatus; replacedBy?: string | null }) {
  return status === 'blocked' ? (
    <Badge variant="destructive">
      <Ban aria-hidden="true" /> Blocked{replacedBy ? `, use ${replacedBy}` : ''}
    </Badge>
  ) : (
    <Badge variant="success">
      <CheckCircle2 aria-hidden="true" /> Active
    </Badge>
  )
}
