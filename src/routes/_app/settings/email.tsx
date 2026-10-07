import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MailX } from 'lucide-react'
import { getSupabase } from '~/lib/supabase'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/settings/email')({
  head: () => ({ meta: [{ title: 'Email settings · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/settings/email')}>
      <EmailSettingsPage />
    </RequireRole>
  ),
})

interface MailSettings {
  enabled: boolean
  from_name: string | null
  from_address: string | null
  smtp_host: string | null
  smtp_port: number | null
  smtp_user: string | null
  imap_host: string | null
  imap_port: number | null
  imap_user: string | null
}

const FIELDS: { key: keyof MailSettings; label: string; hint?: string; numeric?: boolean }[] = [
  { key: 'from_name', label: 'Sender name', hint: 'Shown to buyers and farms, e.g. ConsolFlora' },
  { key: 'from_address', label: 'Sender address', hint: 'e.g. orders@consolflora.com' },
  { key: 'smtp_host', label: 'Outgoing server (SMTP)', hint: 'Zoho: smtp.zoho.com (or smtppro.zoho.com for paid plans)' },
  { key: 'smtp_port', label: 'SMTP port', hint: 'Zoho: 465 (SSL)', numeric: true },
  { key: 'smtp_user', label: 'SMTP user', hint: 'Usually the mailbox address' },
  { key: 'imap_host', label: 'Incoming server (IMAP)', hint: 'Zoho: imap.zoho.com (or imappro.zoho.com)' },
  { key: 'imap_port', label: 'IMAP port', hint: 'Zoho: 993 (SSL)', numeric: true },
  { key: 'imap_user', label: 'IMAP user', hint: 'Usually the mailbox address' },
]

function EmailSettingsPage() {
  const q = useQuery({
    queryKey: ['mail-settings'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('mail_settings').select('*').maybeSingle()
      if (error) throw new Error(error.message)
      return data as MailSettings | null
    },
  })
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <Alert variant="destructive" title="Couldn't load the email settings" role="alert" />
  return <SettingsForm settings={q.data} />
}

function SettingsForm({ settings }: { settings: MailSettings }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, settings[f.key] == null ? '' : String(settings[f.key])])))
  const [error, setError] = React.useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const patch: Record<string, string | number | null> = {}
    for (const f of FIELDS) {
      const v = values[f.key]!.trim()
      if (f.numeric && v && !/^\d+$/.test(v)) return setError(`${f.label}: a number, e.g. 465.`)
      patch[f.key] = v === '' ? null : f.numeric ? Number(v) : v
    }
    setError(null)
    const { error } = await getSupabase().from('mail_settings').update(patch).eq('id', true)
    if (error) return setError(error.message)
    toast({ kind: 'success', title: 'Email settings saved', description: 'Email stays off until it is switched on in the last item.' })
    void queryClient.invalidateQueries({ queryKey: ['mail-settings'] })
  }

  return (
    <>
      <PageHeader title="Email settings" description="Where ConsolFlora's emails will come from, and where replies are read." />
      <div className="grid grid-cols-1 gap-4">
        <Alert variant="warning" title="Not connected: email is switched off">
          <span className="flex items-start gap-2">
            <MailX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Notifications are shown in the app and wait here until email is switched on. The mailbox passwords are never stored in the app:
            they go into the server settings (SMTP_PASSWORD and IMAP_PASSWORD) when you are ready.
          </span>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Zoho mailbox</CardTitle>
            <CardDescription>Fill in what you know now; it can be changed any time.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} noValidate className="grid gap-4">
              {error && <Alert variant="destructive" title={error} role="alert" />}
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <Field key={f.key} id={`mail-${f.key}`} label={f.label} hint={f.hint}>
                    {(d) => (
                      <Input
                        id={`mail-${f.key}`}
                        inputMode={f.numeric ? 'numeric' : undefined}
                        value={values[f.key]}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        aria-describedby={d}
                      />
                    )}
                  </Field>
                ))}
              </div>
              <div>
                <Button type="submit">Save settings</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
