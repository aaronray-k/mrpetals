import * as React from 'react'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { getSupabase } from '~/lib/supabase'
import { useAuth } from '~/lib/auth'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { SetupNeeded } from '~/components/layout/setup-needed'

/** Preview site only (VITE_PREVIEW_DEMO_PASSWORD set at build): demo accounts, one per role. */
const DEMO_PASSWORD = import.meta.env.VITE_PREVIEW_DEMO_PASSWORD as string | undefined
const DEMO_ACCOUNTS = [
  ['Admin', 'admin'],
  ['Consolidator', 'consolidator'],
  ['Finance', 'finance'],
  ['QC', 'qc'],
  ['Senior QC', 'senior.qc'],
  ['Farm (Kibo Roses)', 'farm'],
  ['Buyer (Pacific Floral)', 'buyer'],
] as const

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
        {DEMO_PASSWORD && (
          <Card>
            <CardHeader>
              <CardTitle>Preview: demo accounts</CardTitle>
              <CardDescription>
                Demo data only. Every account's password is <strong className="font-mono">{DEMO_PASSWORD}</strong>. Pick a role to fill in the form.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1">
                {DEMO_ACCOUNTS.map(([role, user]) => (
                  <li key={user}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left hover:bg-muted"
                      onClick={() => {
                        setEmail(`${user}@demo.consolflora.com`)
                        setPassword(DEMO_PASSWORD)
                      }}
                    >
                      <span className="font-semibold">{role}</span>
                      <span className="truncate text-sm text-muted-foreground">{user}@demo.consolflora.com</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
