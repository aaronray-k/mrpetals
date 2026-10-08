import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Mail, Send } from 'lucide-react'
import { downloadBase64Pdf, proformaPdfFile, sendInvoiceByEmail, useInvoiceEmailDraft, useInvoiceEmails } from '~/lib/invoices/api'
import { parseAddresses } from '~/lib/invoices/email'
import { formatDateTime } from '~/lib/utils'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

/** "Send by email" on a confirmed invoice: the message filled in, to check or edit, with the PDFs attached. */
export function EmailInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Mail aria-hidden="true" /> Send by email
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Email the invoice to the buyer" className="w-[min(46rem,calc(100vw-2rem))]">
        <EmailForm invoiceId={invoiceId} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  )
}

function EmailForm({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const draft = useInvoiceEmailDraft(invoiceId, true)
  if (draft.isLoading) return <Spinner />
  if (draft.error || !draft.data) return <Alert variant="destructive" title="Couldn't prepare the email" role="alert">{(draft.error as Error | null)?.message}</Alert>
  return <Form key={draft.dataUpdatedAt} invoiceId={invoiceId} d={draft.data} onDone={onDone} />
}

type Draft = NonNullable<ReturnType<typeof useInvoiceEmailDraft>['data']>
function Form({ invoiceId, d, onDone }: { invoiceId: string; d: Draft; onDone: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [to, setTo] = React.useState(d.to)
  const [cc, setCc] = React.useState('')
  const [subject, setSubject] = React.useState(d.subject)
  const [body, setBody] = React.useState(d.body)
  const [attachInvoice, setAttachInvoice] = React.useState(true)
  const [orders, setOrders] = React.useState<string[]>(d.proformas.map((p) => p.orderId))
  const [errors, setErrors] = React.useState<string[]>([])
  const [sending, setSending] = React.useState(false)
  const [downloading, setDownloading] = React.useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const t = parseAddresses(to)
    const c = parseAddresses(cc)
    const errs: string[] = []
    if (!t.ok.length) errs.push('Add at least one address to send to.')
    if (t.bad.length || c.bad.length) errs.push(`Check these addresses: ${[...t.bad, ...c.bad].join(', ')}`)
    if (!subject.trim()) errs.push('Add a subject.')
    if (!body.trim()) errs.push('Write a message.')
    setErrors(errs)
    if (errs.length) return
    setSending(true)
    try {
      const r = await sendInvoiceByEmail({ invoiceId, to: t.ok, cc: c.ok, subject: subject.trim(), body, attachInvoice, orderIds: orders })
      void queryClient.invalidateQueries({ queryKey: ['invoice-emails', invoiceId] })
      if (r.ok) {
        toast({ kind: 'success', title: 'Invoice emailed', description: r.message })
        onDone()
      } else setErrors([r.message])
    } catch (err) {
      setErrors([(err as Error).message])
    } finally {
      setSending(false)
    }
  }

  return (
    <form noValidate onSubmit={send} className="grid gap-4">
      {!d.confirmed && <Alert variant="warning" title="Confirm the invoice first">Only a confirmed invoice can be emailed.</Alert>}
      {!d.mail.ready && (
        <Alert variant="warning" title="Email isn't set up yet">
          {d.mail.reason} You can still download the attachments below.
        </Alert>
      )}
      {d.bankMissing && (
        <Alert title="No bank account for this currency">
          The message has no bank details. An Admin adds them on{' '}
          <Link to="/settings/email" className="font-semibold underline">
            Email settings
          </Link>
          .
        </Alert>
      )}
      {errors.length > 0 && (
        <Alert variant="destructive" title="Not sent" role="alert">
          <ul className="list-disc pl-5">
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Alert>
      )}
      {d.mail.from && <p className="text-sm text-muted-foreground">From {d.mail.from}; replies come back there.</p>}
      <OdooContacts
        d={d}
        add={(email, field) => {
          const [value, set] = field === 'to' ? [to, setTo] : [cc, setCc]
          if (!parseAddresses(value).ok.includes(email)) set(value.trim() ? `${value.trim().replace(/,\s*$/, '')}, ${email}` : email)
        }}
      />
      <Field id="em-to" label="To" hint="Separate several addresses with commas.">
        {(h) => <Input id="em-to" type="text" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={h} />}
      </Field>
      <Field id="em-cc" label="Cc">
        {(h) => <Input id="em-cc" type="text" inputMode="email" autoComplete="off" value={cc} onChange={(e) => setCc(e.target.value)} aria-describedby={h} />}
      </Field>
      <Field id="em-subject" label="Subject">
        {(h) => <Input id="em-subject" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} aria-describedby={h} />}
      </Field>
      <Field id="em-body" label="Message">
        {(h) => (
          <textarea
            id="em-body"
            rows={14}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-describedby={h}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-base leading-relaxed"
          />
        )}
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Attachments</legend>
        <label className="flex min-h-10 items-center gap-2">
          <input type="checkbox" className="size-5" checked={attachInvoice} onChange={(e) => setAttachInvoice(e.target.checked)} />
          Odoo's invoice PDF ({d.invoiceFile})
        </label>
        {d.proformas.map((p) => (
          <div key={p.orderId} className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex min-h-10 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={orders.includes(p.orderId)}
                onChange={(e) => setOrders((o) => (e.target.checked ? [...o, p.orderId] : o.filter((x) => x !== p.orderId)))}
              />
              Proforma invoice {p.orderNumber} (PDF)
            </label>
            <Button
              variant="ghost"
              size="sm"
              disabled={downloading === p.orderId}
              onClick={async () => {
                setDownloading(p.orderId)
                try {
                  const f = await proformaPdfFile(p.orderId)
                  downloadBase64Pdf(f.name, f.base64)
                } catch (err) {
                  toast({ kind: 'error', title: 'Not downloaded', description: (err as Error).message })
                } finally {
                  setDownloading(null)
                }
              }}
            >
              <Download aria-hidden="true" /> {downloading === p.orderId ? 'Making…' : 'Download'}
              <span className="sr-only"> proforma {p.orderNumber}</span>
            </Button>
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={sending || !d.mail.ready || !d.confirmed}>
          <Send aria-hidden="true" /> {sending ? 'Sending…' : 'Send email'}
        </Button>
      </div>
    </form>
  )
}

/** Every email of this invoice: when, by whom, to whom, with what, and whether it went. */
export function InvoiceEmailsCard({ invoiceId }: { invoiceId: string }) {
  const emails = useInvoiceEmails(invoiceId)
  if (!emails.data?.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Emails</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 text-sm">
          {emails.data.map((m) => (
            <li key={m.id} className="grid gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={m.ok ? 'success' : 'destructive'}>{m.ok ? 'Sent' : 'Not sent'}</Badge>
                {formatDateTime(m.sent_at)}
                {m.profiles?.full_name && <span className="text-muted-foreground">by {m.profiles.full_name}</span>}
              </span>
              <span>
                To {m.to_addresses.join(', ')}
                {m.cc_addresses.length > 0 && `, cc ${m.cc_addresses.join(', ')}`}
              </span>
              {m.attachments.length > 0 && <span className="text-muted-foreground">{m.attachments.join(', ')}</span>}
              {m.error && <span className="text-destructive">{m.error}</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** The buyer's contacts in Odoo, to add to To or Cc. */
function OdooContacts({ d, add }: { d: Draft; add: (email: string, field: 'to' | 'cc') => void }) {
  if (d.contactsError) return <p className="text-sm text-muted-foreground">Odoo contacts couldn't be read ({d.contactsError}); To has ConsolFlora's contact email.</p>
  if (!d.contacts.length) return <p className="text-sm text-muted-foreground">This buyer has no contacts with an email in Odoo; To has ConsolFlora's contact email.</p>
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Contacts in Odoo ({d.contacts.length}). To starts with the {d.contacts.some((c) => c.type === 'invoice') ? 'invoice address' : 'company email'}.
      </summary>
      <ul className="mt-2 grid gap-2">
        {d.contacts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-semibold">{c.name}</span>
              {c.type === 'invoice' && <Badge variant="success" className="ml-1">Invoice address</Badge>}
              {c.job && <span className="text-muted-foreground"> · {c.job}</span>}
              <span className="block break-all text-muted-foreground">{c.email}</span>
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => add(c.email!, 'to')}>
                Add to To<span className="sr-only">: {c.email}</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => add(c.email!, 'cc')}>
                Add to Cc<span className="sr-only">: {c.email}</span>
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
