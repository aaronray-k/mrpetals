import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { PlugZap } from 'lucide-react'
import { saveOdooSettings, setUpLineProduct, testOdooConnection, useOdooLog, useOdooMappingOptions, useOdooSettings, useOdooStatus, type OdooSettings } from '~/lib/odoo/api'
import type { MappedField } from '~/server/odoo/client'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
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
      <LineProduct settings={settings} />
      <FieldMapping settings={settings} />
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

const MAPPED: { key: MappedField; label: string; hint: string }[] = [
  { key: 'mawb', label: 'MAWB / AWB', hint: "The shipment's master air waybill." },
  { key: 'proforma', label: 'Proforma invoice no.', hint: "The buyer's order numbers on the flight, e.g. CFLPFJ0001, CFLPFJ0003." },
  { key: 'flight', label: 'Flight number', hint: "The shipment's flight, e.g. KQ 1406." },
]
/** "Net 30", "30 Days", "Prepaid", "Immediate Payment": the number of days, for matching ConsolFlora's terms to Odoo's. */
const FIXED_BY_CONSOLFLORA = new Set(['15th of following month'])
const daysOf = (t: string) => (/prepa|immediate|cash|advance/i.test(t) ? 0 : (t.match(/\d+/)?.[0] ? Number(t.match(/\d+/)![0]) : null))

/** Which of Odoo's invoice fields get the MAWB, proforma numbers and flight, and which Odoo payment term each buyer's terms are. */
function FieldMapping({ settings }: { settings: OdooSettings }) {
  const options = useOdooMappingOptions()
  const toast = useToast()
  const queryClient = useQueryClient()
  const o = options.data
  const [fields, setFields] = React.useState<Partial<Record<MappedField, string>> | null>(null)
  const [terms, setTerms] = React.useState<Record<string, number> | null>(null)
  // Start from what is saved; where nothing is saved yet, from Odoo's field labels and the number of days.
  React.useEffect(() => {
    if (!o || o.error || fields) return
    const g = o.guesses as Partial<Record<MappedField, string | null>>
    setFields(Object.fromEntries(MAPPED.map((m) => [m.key, settings.field_map[m.key] ?? g[m.key] ?? ''])))
    setTerms(
      Object.fromEntries(
        o.buyerTerms.filter((t) => !FIXED_BY_CONSOLFLORA.has(t)).map((t) => {
          const saved = settings.payment_term_map[t]
          const guess = o.terms.find((x) => daysOf(x.name) != null && daysOf(x.name) === daysOf(t))
          return [t, saved ?? guess?.id ?? 0]
        }),
      ),
    )
  }, [o, fields, settings])
  const guessed = (k: MappedField) => !settings.field_map[k] && !!fields?.[k]

  async function save() {
    try {
      const field_map = Object.fromEntries(Object.entries(fields ?? {}).filter(([, v]) => v))
      const payment_term_map = Object.fromEntries(Object.entries(terms ?? {}).filter(([, v]) => v))
      await saveOdooSettings({ field_map, payment_term_map })
      toast({ kind: 'success', title: 'Invoice fields saved', description: 'New drafts get them; on an existing draft, use Fill in again from ConsolFlora.' })
      void queryClient.invalidateQueries({ queryKey: ['odoo-settings'] })
    } catch (e) {
      toast({ kind: 'error', title: 'Not saved', description: (e as Error).message })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice fields in Odoo</CardTitle>
        <CardDescription>
          ConsolFlora fills these into each draft invoice. The fields are read from your Odoo invoice form; ones suggested from their names are marked
          Suggested until you save.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {options.isLoading ? (
          <Spinner />
        ) : o?.error ? (
          <Alert variant="warning" title="Couldn't read Odoo's invoice fields">
            {o.error} Fill in the connection above and save it first.
          </Alert>
        ) : o && fields && terms ? (
          <div className="grid gap-6 sm:max-w-xl">
            <div className="grid gap-4">
              {MAPPED.map((m) => (
                <Field key={m.key} id={`map-${m.key}`} label={<>{m.label} {guessed(m.key) && <Badge variant="warning">Suggested</Badge>}</>} hint={m.hint}>
                  {(d) => (
                    <Select id={`map-${m.key}`} value={fields[m.key] ?? ''} onChange={(e) => setFields({ ...fields, [m.key]: e.target.value })} aria-describedby={d}>
                      <option value="">Not sent to Odoo</option>
                      {o.fields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label} ({f.name})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>
            <fieldset className="grid gap-4">
              <legend className="mb-2 font-semibold">Payment terms</legend>
              <p className="text-sm text-muted-foreground">Each buyer's terms in ConsolFlora, as an Odoo payment term. Odoo works out the due date when the invoice is confirmed.</p>
              {o.buyerTerms.filter((t) => FIXED_BY_CONSOLFLORA.has(t)).map((t) => (
                <p key={t} className="text-sm">
                  <strong>{t}</strong>: ConsolFlora sets the due date itself, the 15th of the month after the latest order on the invoice was
                  placed, so no Odoo payment term is needed.
                </p>
              ))}
              {o.buyerTerms.filter((t) => !FIXED_BY_CONSOLFLORA.has(t)).map((t, n) => (
                <Field key={t} id={`term-${n}`} label={t}>
                  {(d) => (
                    <Select id={`term-${n}`} value={terms[t] ?? 0} onChange={(e) => setTerms({ ...terms, [t]: Number(e.target.value) })} aria-describedby={d}>
                      <option value={0}>Leave to Odoo (the customer's default)</option>
                      {o.terms.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </fieldset>
            <Button className="w-fit" onClick={() => void save()}>
              Save invoice fields
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** The Odoo product on every invoice line: Kenya's eTIMS needs one. ConsolFlora makes "Cut Flowers" in Odoo once. */
function LineProduct({ settings }: { settings: OdooSettings }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Product on invoice lines</CardTitle>
        <CardDescription>
          Each invoice and credit note line carries this Odoo product (KRA eTIMS needs a product on every line), with ConsolFlora's description
          and amount. In Odoo, give the product its eTIMS item code and classification, and its taxes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p>
          {settings.line_product_id ? (
            <>
              <strong>{settings.line_product_name}</strong> (Odoo product #{settings.line_product_id}, reference CONSOLFLORA-FLOWERS)
            </>
          ) : (
            <span className="text-muted-foreground">Not set yet: made in Odoo the first time an invoice is sent, or now.</span>
          )}
        </p>
        <Button
          variant="outline"
          className="w-fit"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await setUpLineProduct()
              toast({ kind: r.ok ? 'success' : 'error', title: r.ok ? 'Product ready' : 'Not done', description: r.message })
              void queryClient.invalidateQueries({ queryKey: ['odoo-settings'] })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Working…' : settings.line_product_id ? 'Check it in Odoo' : 'Make it in Odoo now'}
        </Button>
      </CardContent>
    </Card>
  )
}
