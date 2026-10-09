import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useAuth } from '~/lib/auth'
import { Spinner } from '~/components/ui/spinner'
import { SetupNeeded } from '~/components/layout/setup-needed'

export const Route = createFileRoute('/')({
  ssr: false,
  component: Home,
})

function Home() {
  const { status } = useAuth()
  if (status === 'not-configured') return <SetupNeeded />
  if (status === 'loading') return <Spinner className="m-8" />
  return <Navigate to={status === 'signed-in' ? '/dashboard' : '/sign-in'} replace />
}
