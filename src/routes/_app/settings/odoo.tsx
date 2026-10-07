import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { PlugZap } from 'lucide-react'
import { saveOdooSettings, testOdooConnection, useOdooLog, useOdooSettings, useOdooStatus, type OdooSettings } from '~/lib/odoo/api'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/settings/odoo')({
  head: () => ({ meta: [{ title: 'Odoo settings · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/settings/odoo')}>
      <OdooSettingsPage />
    </RequireRole>
  ),
})

function OdooSettingsPage() {
  const s = useOdooSettings()
  return (
    <>
      <PageHeader title="Odoo settings" description="Where invoices and credit notes are made. The API key is kept in the server environment, never here." />
      {s.isLoading ? <Spinner /> : s.data ? <SettingsForm key={JSON.stringify(s.data)} settings={s.data} /> : <Alert variant="destructive" title="Couldn't load the settings" />}
    </>
  )
}

function SettingsForm({ settings }: { settings: OdooSettings }) {
  const status = useOdooStatus()
  const log = useOdooLog()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [url, setUrl] = React.useState(settings.url ?? '')
  const [db, setDb] = React.useState(settings.database ?? '')
  const [login, setLogin] = React.useState(settings.login ?? '')
  const [label, setLabel] = React.useState(settings.line_label)
  const [enabled, setEnabled] = React.useState(settings.enabled)
  const [error, setError] = React.useState<string | null>(null)
  const [testing, setTesting] = React.useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const u = url.trim().replace(/\/$/, '')
    if (u && !/^https:\/\/[^\s]+$/.test(u)) return setError('The Odoo address starts with https://, e.g. https://consolflora.odoo.com')
    if (label.trim().length < 2) return setError('Give the invoice line a name.')
    setError(null)
    try {
      await saveOdooSettings({ url: u || null, database: db.trim() || null, login: login.trim() || null, line_label: label.trim(), enabled })
      toast({ kind: 'success', title: 'Odoo settings saved' })
      for (const k of ['odoo-settings', 'odoo-status']) void queryClient.invalidateQueries({ queryKey: [k] })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Connection</CardTitle>
            {status.data && (
              <Badge variant={status.data.source === 'none' ? 'warning' : 'success'}>
                {status.data.source === 'api' ? 'Connected to Odoo' : status.data.source === 'demo' ? 'Demo Odoo (preview)' : 'Not connected'}
              </Badge>
            )}
          </div>
          <CardDescription>
            {status.data?.reason ?? 'Odoo Online needs the Custom plan for outside apps to create invoices.'} API key in the server environment:{' '}
            <strong>{status.data?.apiKeySet ? 'set' : 'not set'}</strong> (ODOO_API_KEY; create it in Odoo under your user → Account security → API keys).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} noValidate className="grid gap-4 sm:max-w-xl">
            {error && <Alert variant="destructive" title={error} role="alert" />}
            <Field id="odoo-url" label="Odoo address" hint="e.g. https://consolflora.odoo.com">
              {(d) => <Input id="odoo-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="odoo-db" label="Database" hint="On Odoo Online, usually the first part of the address (consolflora).">
              {(d) => <Input id="odoo-db" value={db} onChange={(e) => setDb(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="odoo-login" label="Odoo user (login email)" hint="The user the API key belongs to; it needs Accounting rights.">
              {(d) => <Input id="odoo-login" type="email" value={login} onChange={(e) => setLogin(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="odoo-label" label="Invoice line" hint="The one line on every invoice; credit notes add the claim number.">
              {(d) => <Input id="odoo-label" value={label} onChange={(e) => setLabel(e.target.value)} aria-describedby={d} />}
            </Field>
            <Switch checked={enabled} onCheckedChange={setEnabled} label="Send invoices to Odoo" />
            <p className="text-sm text-muted-foreground">
              {settings.send_from
                ? `Sending since ${formatDateTime(settings.send_from)}. Invoices made before then are not sent.`
                : 'Test the connection first; it works while sending is off. When you switch sending on, invoices made before that moment are not sent (go-live).'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save settings</Button>
              <Button
                variant="outline"
                disabled={testing}
                onClick={async () => {
                  setTesting(true)
                  try {
                    const r = await testOdooConnection()
                    toast({ kind: r.ok ? 'success' : 'error', title: r.ok ? 'Odoo answered' : 'Odoo did not answer', description: r.message })
                    void queryClient.invalidateQueries({ queryKey: ['odoo-log'] })
                  } finally {
                    setTesting(false)
                  }
                }}
              >
                <PlugZap aria-hidden="true" /> {testing ? 'Testing…' : 'Test connection'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Last fetched from Odoo: {settings.last_fetch_at ? formatDateTime(settings.last_fetch_at) : 'never'}.</CardDescription>
        </CardHeader>
        <CardContent>
          {log.data?.length ? (
            <ul className="grid gap-2 text-sm">
              {log.data.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(l.at)}</span>
                  <Badge variant={l.ok ? 'success' : 'destructive'}>{l.ok ? 'OK' : 'Failed'}</Badge>
                  <span className="capitalize">{l.action}</span>
                  <span>{l.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">Nothing yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
