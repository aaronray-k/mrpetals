import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'
import { useAuth } from '~/lib/auth'
import { AppShell } from '~/components/layout/app-shell'
import { SetupNeeded } from '~/components/layout/setup-needed'
import { ChangePassword } from '~/components/layout/change-password'
import { LegalGate } from '~/components/legal/consent-step'
import { TwoFactorGate } from '~/components/auth/two-factor-gate'
import { Spinner } from '~/components/ui/spinner'

// The session lives in the browser, so signed-in pages render on the client only.
export const Route = createFileRoute('/_app')({
  ssr: false,
  component: AppLayout,
})

function AppLayout() {
  const { status, session } = useAuth()
  if (status === 'not-configured') return <SetupNeeded />
  if (status === 'loading') return <Spinner className="m-8" />
  if (status === 'signed-out') return <Navigate to="/sign-in" replace />
  if (session?.user.user_metadata?.must_change_password) return <ChangePassword />
  return (
    <TwoFactorGate>
      <LegalGate>
        <AppShell>
          <Outlet />
        </AppShell>
      </LegalGate>
    </TwoFactorGate>
  )
}
