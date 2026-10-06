import * as React from 'react'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { getSupabase } from '~/lib/supabase'
import { useAuth } from '~/lib/auth'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { SetupNeeded } from '~/components/layout/setup-needed'

export const Route = createFileRoute('/sign-in')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Sign in · ConsolFlora' }] }),
  component: SignIn,
})

function SignIn() {
  const { status } = useAuth()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  if (status === 'not-configured') return <SetupNeeded />
  if (status === 'signed-in') return <Navigate to="/dashboard" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await getSupabase().auth.signInWithPassword({ email, password })
    // On success the auth state changes and the redirect below takes over.
    if (error) {
      setBusy(false)
      setError('Email or password is not right. Check both and try again.')
    }
  }

  async function onForgot() {
    if (!email) {
      setError('Enter your email address first, then choose "Forgot password".')
      return
    }
    setError(null)
    await getSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/sign-in` })
    setNotice(`If ${email} has an account, a reset link is on its way.`)
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-sidebar p-4">
      <div className="grid w-full max-w-md gap-6">
        <img src="/consolflora-logo-dark.png" alt="ConsolFlora" width={240} height={98} className="mx-auto h-auto w-[240px]" />
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use the business email your ConsolFlora account was set up with.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              {error && <Alert variant="destructive" title={error} role="alert" />}
              {notice && <Alert variant="success" title={notice} role="status" />}
              <Field id="email" label="Email">
                {(d) => (
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-describedby={d}
                  />
                )}
              </Field>
              <Field id="password" label="Password">
                {(d) => (
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby={d}
                  />
                )}
              </Field>
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
              <Button variant="link" onClick={onForgot} className="justify-self-start">
                Forgot password?
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
