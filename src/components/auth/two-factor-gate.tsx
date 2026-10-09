import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { KeyRound, Mail, Smartphone } from 'lucide-react'
import { useAuth } from '~/lib/auth'
import {
  sendEmailCode,
  sessionIdOf,
  setRememberedDevice,
  startTotpSetup,
  tryRememberedDevice,
  twoFactorStatus,
  verifyEmailCode,
  verifyTotp,
  type TwoFactorStatus,
  type VerifyResult,
} from '~/lib/two-factor'
import { LegalFooter } from '~/components/legal/legal-footer'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'

/**
 * Second sign-in step for Admin, Consolidator and Finance: a code from an authenticator app or by email.
 * The database checks it per sign-in session, so these roles have no access until it is done.
 */
export function TwoFactorGate({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const sessionId = sessionIdOf(session?.access_token)
  const status = useQuery({
    queryKey: ['two-factor', userId, sessionId],
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: async () => {
      const s = await twoFactorStatus()
      // A device remembered in the last 30 days skips the code.
      if (s.required && !s.verified && userId && (await tryRememberedDevice(userId))) return twoFactorStatus()
      return s
    },
  })
  if (status.isLoading) return <Spinner className="m-8" />
  if (status.error) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <Alert variant="destructive" title="Couldn't check your sign-in" role="alert">
          {(status.error as Error).message}
        </Alert>
      </main>
    )
  }
  if (!status.data?.required || status.data.verified) return <>{children}</>
  return <TwoFactorStep status={status.data} />
}

type Mode = 'app' | 'setup' | 'email'

function TwoFactorStep({ status }: { status: TwoFactorStatus }) {
  const { session, signOut } = useAuth()
  const queryClient = useQueryClient()
  const [mode, setMode] = React.useState<Mode>(status.totp ? 'app' : status.email_available ? 'email' : 'setup')
  const [remember, setRemember] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function done(r: VerifyResult) {
    if (!r.ok) return setError(r.error ?? 'That code is not right.')
    if (r.device_token && session) setRememberedDevice(session.user.id, r.device_token)
    await queryClient.invalidateQueries({ queryKey: ['two-factor'] })
  }

  return (
    <div className="min-h-dvh bg-sidebar">
      <main id="main" className="mx-auto grid max-w-lg gap-4 px-4 py-8">
        <img src="/consolflora-logo-dark.png" alt="ConsolFlora" width={180} height={73} className="h-auto w-[180px]" />
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-bold leading-tight">Confirm it's you</h1>
            <CardDescription>
              Your role needs a second step at sign-in: a 6-digit code from an authenticator app on your phone, or sent to your email.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {status.locked && <Alert variant="destructive" title="Too many wrong codes. Wait 15 minutes and try again." role="alert" />}
            {error && <Alert variant="destructive" title={error} role="alert" />}
            <div role="tablist" aria-label="How to get your code" className="grid grid-cols-2 gap-1 rounded-md border p-1">
              <TabButton active={mode !== 'email'} onClick={() => { setError(null); setMode(status.totp ? 'app' : 'setup') }} icon={<Smartphone aria-hidden="true" />}>
                Authenticator app
              </TabButton>
              <TabButton active={mode === 'email'} onClick={() => { setError(null); setMode('email') }} icon={<Mail aria-hidden="true" />}>
                Email
              </TabButton>
            </div>
            <div role="tabpanel" className="grid gap-4">
              {mode === 'app' && <AppCode onDone={done} remember={remember} onError={setError} />}
              {mode === 'setup' && <AppSetup onDone={done} remember={remember} onError={setError} />}
              {mode === 'email' &&
                (status.email_available ? (
                  <EmailCode onDone={done} remember={remember} onError={setError} />
                ) : (
                  <Alert title="Email codes aren't available yet">Email codes start once the ConsolFlora mailbox is connected. Use an authenticator app for now.</Alert>
                ))}
            </div>
            {status.remember_days > 0 && (
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-0.5 size-6 shrink-0 accent-accent" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>
                  Remember this device for {status.remember_days} days
                  <span className="block text-sm text-muted-foreground">Only on a device that is yours and not shared.</span>
                </span>
              </label>
            )}
            <Button variant="link" onClick={() => void signOut()} className="justify-self-start">
              Sign out
            </Button>
          </CardContent>
        </Card>
        <LegalFooter dark />
      </main>
    </div>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded px-3 text-sm font-semibold [&_svg]:size-4 ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
    >
      {icon}
      {children}
    </button>
  )
}

function CodeForm({ label, hint, onSubmit, submitLabel = 'Confirm' }: { label: string; hint: string; onSubmit: (code: string) => Promise<void>; submitLabel?: string }) {
  const [code, setCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await onSubmit(code.replace(/\s/g, ''))
        } finally {
          setBusy(false)
          setCode('')
        }
      }}
    >
      <Field id="two-factor-code" label={label} hint={hint}>
        {(d) => (
          <Input
            id="two-factor-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-describedby={d}
            className="font-mono text-lg tracking-widest"
          />
        )}
      </Field>
      <Button type="submit" size="lg" disabled={busy || code.replace(/\s/g, '').length !== 6}>
        <KeyRound aria-hidden="true" /> {busy ? 'Checking…' : submitLabel}
      </Button>
    </form>
  )
}

type StepProps = { onDone: (r: VerifyResult) => Promise<void>; remember: boolean; onError: (m: string | null) => void }

function AppCode({ onDone, remember, onError }: StepProps) {
  return (
    <CodeForm
      label="Code from your authenticator app"
      hint="Open the app and type the 6-digit code shown for ConsolFlora."
      onSubmit={async (code) => {
        onError(null)
        try {
          await onDone(await verifyTotp(code, remember))
        } catch (e) {
          onError((e as Error).message)
        }
      }}
    />
  )
}

function AppSetup({ onDone, remember, onError }: StepProps) {
  const [setup, setSetup] = React.useState<{ secret: string; svg: string } | null>(null)
  const [busy, setBusy] = React.useState(false)
  if (!setup)
    return (
      <div className="grid gap-3">
        <p>
          Install an authenticator app on your phone (Google Authenticator or Microsoft Authenticator), then set it up here. You only do this
          once.
        </p>
        <Button
          size="lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            onError(null)
            try {
              const s = await startTotpSetup()
              setSetup({ secret: s.secret, svg: await QRCode.toString(s.uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) })
            } catch (e) {
              onError((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Smartphone aria-hidden="true" /> Set up the authenticator app
        </Button>
      </div>
    )
  return (
    <div className="grid gap-4">
      <ol className="grid list-decimal gap-2 pl-5">
        <li>In the app, add an account and scan this QR code.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <div
        role="img"
        aria-label="QR code for your authenticator app. If you can't scan it, type the key shown below instead."
        className="mx-auto w-48 rounded-md bg-white p-2"
        dangerouslySetInnerHTML={{ __html: setup.svg }}
      />
      <p className="text-sm">
        Can't scan? Type this key into the app: <code className="rounded bg-muted px-1.5 py-0.5 font-mono break-all">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
      </p>
      <CodeForm
        label="Code from your authenticator app"
        hint="The code changes every 30 seconds."
        submitLabel="Finish setting up"
        onSubmit={async (code) => {
          onError(null)
          try {
            await onDone(await verifyTotp(code, remember))
          } catch (e) {
            onError((e as Error).message)
          }
        }}
      />
    </div>
  )
}

function EmailCode({ onDone, remember, onError }: StepProps) {
  const [sent, setSent] = React.useState<{ sent_to: string; demo_code: string | null } | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function send() {
    setBusy(true)
    onError(null)
    try {
      setSent(await sendEmailCode())
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-3">
      {!sent ? (
        <Button size="lg" onClick={send} disabled={busy}>
          <Mail aria-hidden="true" /> {busy ? 'Sending…' : 'Email me a code'}
        </Button>
      ) : (
        <>
          <p role="status">We sent a code to {sent.sent_to}. It works for 10 minutes.</p>
          {sent.demo_code && (
            <Alert variant="warning" title={`Preview only: your code is ${sent.demo_code}`}>
              Email isn't connected on the preview, so the code is shown here instead of being sent.
            </Alert>
          )}
          <CodeForm
            label="Code from the email"
            hint="Check your inbox for an email from ConsolFlora."
            onSubmit={async (code) => {
              onError(null)
              try {
                await onDone(await verifyEmailCode(code, remember))
              } catch (e) {
                onError((e as Error).message)
              }
            }}
          />
          <Button variant="link" onClick={send} disabled={busy} className="justify-self-start">
            Send a new code
          </Button>
        </>
      )}
    </div>
  )
}
