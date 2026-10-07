import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Mail } from 'lucide-react'
import { markNotificationsRead, useNotifications } from '~/lib/ordering/api'
import { useAuth } from '~/lib/auth'
import { hasAnyRole } from '~/lib/roles'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/_app/notifications')({
  head: () => ({ meta: [{ title: 'Notifications · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/notifications')}>
      <NotificationsPage />
    </RequireRole>
  ),
})

function NotificationsPage() {
  const q = useNotifications()
  const { roles } = useAuth()
  const queryClient = useQueryClient()
  const unread = (q.data ?? []).filter((n) => !n.read_at)
  const staff = hasAnyRole(roles, ['admin', 'consolidator', 'finance'])

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What happened on your orders. Each one is also emailed once ConsolFlora's mail settings are filled in."
        actions={
          unread.length > 0 && (
            <Button
              variant="outline"
              onClick={async () => {
                await markNotificationsRead(unread.map((n) => n.id))
                void queryClient.invalidateQueries({ queryKey: ['notifications'] })
              }}
            >
              Mark all read
            </Button>
          )
        }
      />
      {q.isLoading && <Spinner />}
      {q.error && <Alert variant="destructive" title="Couldn't load notifications" role="alert">{(q.error as Error).message}</Alert>}
      {q.data?.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
      <ul className="grid gap-2">
        {q.data?.map((n) => (
          <li key={n.id} className={cn('grid gap-1 rounded-lg border bg-card p-3', !n.read_at && 'border-primary/50')}>
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              <Bell className="size-4" aria-hidden="true" />
              {!n.read_at && <span className="rounded bg-accent/20 px-1.5 text-xs font-bold">New</span>}
              {n.subject}
            </p>
            {n.body && <p className="text-sm">{n.body}</p>}
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{formatDateTime(n.created_at)}</span>
              <span className="inline-flex items-center gap-1">
                <Mail className="size-4" aria-hidden="true" /> {n.email_status === 'sent' ? 'Emailed' : 'Email waiting for mail settings'}
              </span>
              {n.order_id &&
                (staff ? (
                  <Link to="/orders/$orderId" params={{ orderId: n.order_id }} className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
                    Open order
                  </Link>
                ) : hasAnyRole(roles, ['customer']) ? (
                  <Link to="/my-orders/$orderId" params={{ orderId: n.order_id }} className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
                    Open order
                  </Link>
                ) : null)}
              {n.attachments?.claim_id &&
                (staff ? (
                  <Link to="/claims/$claimId" params={{ claimId: n.attachments.claim_id }} className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
                    Open claim
                  </Link>
                ) : hasAnyRole(roles, ['customer']) ? (
                  <Link to="/my-claims/$claimId" params={{ claimId: n.attachments.claim_id }} className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
                    Open claim
                  </Link>
                ) : null)}
              {n.attachments?.notice_id && hasAnyRole(roles, ['farm']) && (
                <Link to="/farm/claims" className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
                  Open claim notice
                </Link>
              )}
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}
