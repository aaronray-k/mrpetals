import * as React from 'react'
import { getSupabase } from '~/lib/supabase'
import { useAuth } from '~/lib/auth'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'

/** First sign-in with a temporary password: the person chooses their own before going on. */
export function ChangePassword() {
  const { signOut } = useAuth()
  const [password, setPassword] = React.useState('')
  const [again, setAgain] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 10) return setError('Use at least 10 characters.')
    if (password !== again) return setError('The two passwords are different.')
    setBusy(true)
    setError(null)
    const supabase = getSupabase()
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } })
    if (error) {
      setBusy(false)
      return setError(error.message)
    }
    await supabase.auth.refreshSession()
    window.location.assign('/dashboard')
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-sidebar p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose your password</CardTitle>
          <CardDescription>You signed in with a temporary password. Choose your own to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="grid gap-4">
            {error && <Alert variant="destructive" title={error} role="alert" />}
            <Field id="new-password" label="New password" hint="At least 10 characters.">
              {(d) => <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="new-password-2" label="New password again">
              {(d) => <Input id="new-password-2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} aria-describedby={d} />}
            </Field>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Saving…' : 'Save and continue'}
            </Button>
            <Button variant="link" onClick={() => void signOut()} className="justify-self-start">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
