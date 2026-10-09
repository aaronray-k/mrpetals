import * as React from 'react'
import { Alert } from '~/components/ui/alert'
import { useAuth } from '~/lib/auth'
import { ROLE_LABELS, hasAnyRole, type Role } from '~/lib/roles'

/**
 * Hides a page from roles that shouldn't use it. This is for a clear message only:
 * the data itself is protected by RLS, whatever the UI shows.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { roles: mine } = useAuth()
  if (!hasAnyRole(mine, roles)) {
    return (
      <Alert variant="warning" title="You don't have access to this page" role="alert">
        It is available to: {roles.map((r) => ROLE_LABELS[r]).join(', ')}. Ask an Admin if you need access.
      </Alert>
    )
  }
  return <>{children}</>
}
