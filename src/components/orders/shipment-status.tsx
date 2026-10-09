import { Lock, Unlock } from 'lucide-react'
import { Badge } from '~/components/ui/badge'

export function ShipmentStatus({ status }: { status: 'open' | 'closed' }) {
  return status === 'open' ? (
    <Badge variant="success">
      <Unlock aria-hidden="true" /> Open
    </Badge>
  ) : (
    <Badge>
      <Lock aria-hidden="true" /> Closed
    </Badge>
  )
}

/** "3 Aug 2026" for a YYYY-MM-DD date. */
export const formatDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '—'
