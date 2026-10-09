import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MailCheck, MailX, Send } from 'lucide-react'
import { saveBank, testEmail, useBank, type BankDetails } from '~/lib/invoices/api'
import { getSupabase } from '~/lib/supabase'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
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
  const [enabled, setEnabled] = React.useState(settings.enabled)
  const [testing, setTesting] = React.useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const patch: Record<string, string | number | boolean | null> = { enabled }
    for (const f of FIELDS) {
      const v = values[f.key]!.trim()
      if (f.numeric && v && !/^\d+$/.test(v)) return setError(`${f.label}: a number, e.g. 465.`)
      patch[f.key] = v === '' ? null : f.numeric ? Number(v) : v
    }
    setError(null)
    const { error } = await getSupabase().from('mail_settings').update(patch).eq('id', true)
    if (error) return setError(error.message)
    toast({ kind: 'success', title: 'Email settings saved', description: enabled ? 'Sending is on.' : 'Sending is off.' })
    void queryClient.invalidateQueries({ queryKey: ['mail-settings'] })
  }

  return (
    <>
      <PageHeader title="Email settings" description="Where ConsolFlora's emails will come from, and where replies are read." />
      <div className="grid grid-cols-1 gap-4">
        {settings.enabled ? (
          <Alert variant="success" title="Sending is on">
            <span className="flex items-start gap-2">
              <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Invoice emails go out from the sender address below. The mailbox password is never stored in the app: it is SMTP_PASSWORD in
              the server settings. Use Send a test email to check it works.
            </span>
          </Alert>
        ) : (
          <Alert variant="warning" title="Email is switched off">
            <span className="flex items-start gap-2">
              <MailX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Invoice emails can't be sent until it is switched on below. The mailbox passwords are never stored in the app: they go into the
              server settings (SMTP_PASSWORD and IMAP_PASSWORD).
            </span>
          </Alert>
        )}
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
              <Switch checked={enabled} onCheckedChange={setEnabled} label="Send email (invoice emails to buyers)" />
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Save settings</Button>
                <Button
                  variant="outline"
                  disabled={testing}
                  onClick={async () => {
                    setTesting(true)
                    try {
                      const r = await testEmail()
                      toast({ kind: r.ok ? 'success' : 'error', title: r.ok ? 'Test email sent' : 'Test email not sent', description: r.message })
                    } finally {
                      setTesting(false)
                    }
                  }}
                >
                  <Send aria-hidden="true" /> {testing ? 'Sending…' : 'Send a test email to me'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <BankAccounts />
      </div>
    </>
  )
}

const BANK_FIELDS: { key: keyof BankDetails; label: string; required?: boolean }[] = [
  { key: 'account_name', label: 'Account name', required: true },
  { key: 'bank_name', label: 'Bank', required: true },
  { key: 'bank_code', label: 'Bank code' },
  { key: 'branch', label: 'Branch' },
  { key: 'swift_code', label: 'SWIFT code' },
]

/** ConsolFlora's bank details, once, and the account number per currency: an invoice email shows the one for its currency. */
function BankAccounts() {
  const bank = useBank()
  const currencies = useQuery({
    queryKey: ['currency-list'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('lookup_values').select('value').eq('list_name', 'Currency').eq('active', true).order('sort_order')
      if (error) throw new Error(error.message)
      return (data as { value: string }[]).map((x) => x.value)
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Bank details for invoice emails</CardTitle>
        <CardDescription>One bank; the account number changes with the invoice's currency. Buyers are asked to quote the invoice number as the payment reference.</CardDescription>
      </CardHeader>
      <CardContent>
        {bank.isLoading || currencies.isLoading ? <Spinner /> : bank.data && <BankForm key={bank.dataUpdatedAt} data={bank.data} currencies={currencies.data ?? []} />}
      </CardContent>
    </Card>
  )
}

function BankForm({ data, currencies }: { data: { details: BankDetails | null; accounts: { currency: string; account_number: string }[] }; currencies: string[] }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [v, setV] = React.useState<Record<string, string>>(() => Object.fromEntries(BANK_FIELDS.map((f) => [f.key, data.details?.[f.key] ?? ''])))
  const [numbers, setNumbers] = React.useState<Record<string, string>>(() => Object.fromEntries(currencies.map((c) => [c, data.accounts.find((a) => a.currency === c)?.account_number ?? ''])))
  const [error, setError] = React.useState<string | null>(null)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const missing = BANK_FIELDS.filter((f) => f.required && !v[f.key]!.trim()).map((f) => f.label)
    if (missing.length) return setError(`Fill in: ${missing.join(', ')}.`)
    setError(null)
    try {
      await saveBank(
        { account_name: v.account_name!.trim(), bank_name: v.bank_name!.trim(), bank_code: v.bank_code!.trim() || null, branch: v.branch!.trim() || null, swift_code: v.swift_code!.trim() || null },
        numbers,
      )
      toast({ kind: 'success', title: 'Bank details saved' })
      void queryClient.invalidateQueries({ queryKey: ['bank'] })
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <form noValidate onSubmit={save} className="grid gap-4">
      {error && <Alert variant="destructive" title={error} role="alert" />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BANK_FIELDS.map((f) => (
          <Field key={f.key} id={`bank-${f.key}`} label={`${f.label}${f.required ? '' : ' (optional)'}`}>
            {(d) => <Input id={`bank-${f.key}`} value={v[f.key]} maxLength={120} onChange={(e) => setV((x) => ({ ...x, [f.key]: e.target.value }))} aria-describedby={d} />}
          </Field>
        ))}
      </div>
      <fieldset className="grid gap-3">
        <legend className="mb-1 font-semibold">Account number by currency</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {currencies.map((c) => (
            <Field key={c} id={`bank-no-${c}`} label={`${c} account number`} hint="Empty: no account in this currency.">
              {(d) => <Input id={`bank-no-${c}`} inputMode="numeric" value={numbers[c] ?? ''} maxLength={40} onChange={(e) => setNumbers((x) => ({ ...x, [c]: e.target.value }))} aria-describedby={d} />}
            </Field>
          ))}
        </div>
      </fieldset>
      <div>
        <Button type="submit">Save bank details</Button>
      </div>
    </form>
  )
}
