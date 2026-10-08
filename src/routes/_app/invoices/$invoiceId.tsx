import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, ExternalLink, RefreshCw, RotateCcw, Upload } from 'lucide-react'
import { invoiceNumber, makePdfInOdoo, odooInvoiceAction, odooInvoicePdf, pushToOdoo, useInvoice, useOdooInvoice, useOdooSettings, useOdooStatus } from '~/lib/odoo/api'
import { cn, formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { EmailInvoiceButton, InvoiceEmailsCard } from '~/components/invoices/email-invoice'
import { FIELD_LABEL, InvoicePreview, day } from '~/components/odoo/invoice-preview'
import { InvoiceStatusBadge } from '~/components/odoo/invoice-status'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/invoices/$invoiceId')({
  head: () => ({ meta: [{ title: 'Invoice · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/invoices')}>
      <InvoicePage />
    </RequireRole>
  ),
})

type Action = 'confirm' | 'reset' | 'update'

function InvoicePage() {
  const { invoiceId } = Route.useParams()
  const invoice = useInvoice(invoiceId)
  const status = useOdooStatus()
  const settings = useOdooSettings()
  const inOdoo = invoice.data?.status === 'pushed'
  const odoo = useOdooInvoice(invoiceId, inOdoo)
  const toast = useToast()
  const queryClient = useQueryClient()
  const [asking, setAsking] = React.useState<Action | null>(null)
  const [busy, setBusy] = React.useState<Action | 'push' | null>(null)

  const refresh = () => {
    for (const k of ['invoices', 'odoo-invoice', 'odoo-log']) void queryClient.invalidateQueries({ queryKey: [k] })
  }
  async function act(action: Action) {
    setAsking(null)
    setBusy(action)
    try {
      const r = await odooInvoiceAction(invoiceId, action)
      if (r.ok)
        toast({
          kind: 'success',
          title: action === 'confirm' ? `Confirmed as ${r.move.name}` : action === 'reset' ? 'Back to draft in Odoo' : 'Draft filled in again from ConsolFlora',
          description:
            action === 'confirm'
              ? [invoice.data?.kind === 'invoice' && 'The buyer has been told.', r.pdf && (r.pdf.ok ? "Odoo's PDF is ready." : `No PDF yet: ${r.pdf.message}`)].filter(Boolean).join(' ')
              : undefined,
        })
      else toast({ kind: 'error', title: 'Odoo said no', description: r.message })
    } catch (e) {
      toast({ kind: 'error', title: 'Not done', description: (e as Error).message })
    } finally {
      setBusy(null)
      refresh()
    }
  }

  if (invoice.isLoading) return <Spinner />
  if (invoice.error) return <Alert variant="destructive" title="Couldn't load this invoice" role="alert">{(invoice.error as Error).message}</Alert>
  const i = invoice.data
  if (!i) return <Alert variant="destructive" title="This invoice doesn't exist, or you may not see it." />

  const d = odoo.data?.detail ?? null
  const sendFrom = settings.data?.send_from ? Date.parse(settings.data.send_from) : null
  const beforeGoLive = status.data?.source === 'api' && i.status !== 'pushed' && sendFrom != null && Date.parse(i.created_at) < sendFrom
  const p = odoo.data?.payload
  const state = d?.state ?? i.odoo_state
  const credit = i.kind === 'credit_note'
  const noun = credit ? 'credit note' : 'invoice'
  // Where Odoo's copy differs from ConsolFlora's (someone changed it in Odoo, or the fields were mapped later).
  const differences: string[] = []
  if (d && p) {
    if (Math.abs(d.amount_untaxed - i.amount) > 0.005) differences.push(`Odoo's amount before tax is ${money(d.amount_untaxed, i.currency)}, ConsolFlora's ${money(i.amount, i.currency)}.`)
    for (const f of d.fields) if ((f.value ?? '') !== (p[f.key] ?? '')) differences.push(`${FIELD_LABEL[f.key]} in Odoo is "${f.value ?? ''}", ConsolFlora has "${p[f.key] ?? ''}".`)
    if (p.payment_term_id && !d.payment_term) differences.push('Odoo has no payment terms on it.')
    if (p.due_date && d.due_date && d.due_date !== p.due_date) differences.push(`Odoo's due date is ${day(d.due_date)}, ConsolFlora's ${day(p.due_date)}.`)
  }

  return (
    <>
      <PageHeader
        title={invoiceNumber({ ...i, odoo_name: d?.name || i.odoo_name, odoo_state: state })}
        description={
          <>
            {i.customers?.company_name} · {i.reference}
          </>
        }
        actions={
          <Link to="/invoices" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" /> All invoices
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>In Odoo</CardTitle>
                <InvoiceStatusBadge invoice={{ ...i, odoo_state: state, odoo_payment_state: d?.payment_state ?? i.odoo_payment_state }} />
              </div>
              <CardDescription>
                {state === 'draft'
                  ? `A draft: check it against the preview, then confirm it. Confirming gives it its Odoo number and date${credit ? '' : ', and tells the buyer'}.`
                  : state === 'posted'
                    ? `Confirmed${i.posted_at ? ` ${formatDateTime(i.posted_at)}` : ''}. To change it, reset it to draft (Odoo refuses once it is paid).`
                    : i.status === 'pushed'
                      ? 'Cancelled in Odoo.'
                      : `Not in Odoo yet.${i.last_error ? ` Last try: ${i.last_error}` : ''}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {beforeGoLive && (
                <Alert variant="warning" title="Made before Odoo go-live: not sent">
                  This invoice was made before sending to your real Odoo was switched on ({formatDateTime(settings.data!.send_from!)}), so it is kept out of
                  your books (on the preview: demo data). Invoices made from now on, when a shipment closes or with New invoice, go to Odoo.
                </Alert>
              )}
              {i.status !== 'pushed' && !beforeGoLive && (
                <Button
                  disabled={!!busy || status.data?.source === 'none'}
                  onClick={async () => {
                    setBusy('push')
                    try {
                      const r = await pushToOdoo({ invoiceIds: [i.id] })
                      toast({ kind: r.pushed ? 'success' : 'error', title: r.pushed ? 'In Odoo as a draft' : 'Not sent', description: r.skipped ?? (r.failed ? 'See the reason above.' : undefined) })
                    } finally {
                      setBusy(null)
                      refresh()
                    }
                  }}
                >
                  <Upload aria-hidden="true" /> Send to Odoo
                </Button>
              )}
              {i.status === 'pushed' && (
                <div className="flex flex-wrap gap-2">
                  {state === 'draft' && (
                    <Button disabled={!!busy || !d} onClick={() => setAsking('confirm')}>
                      <CheckCircle2 aria-hidden="true" /> {busy === 'confirm' ? 'Confirming…' : `Confirm ${noun}`}
                    </Button>
                  )}
                  {state === 'posted' && <EmailInvoiceButton invoiceId={i.id} />}
                  {state === 'posted' && (
                    <Button variant="outline" disabled={!!busy || !d} onClick={() => setAsking('reset')}>
                      <RotateCcw aria-hidden="true" /> {busy === 'reset' ? 'Resetting…' : 'Reset to draft'}
                    </Button>
                  )}
                  {state === 'draft' && (
                    <Button variant="outline" disabled={!!busy || !d} onClick={() => void act('update')}>
                      <RefreshCw className={cn(busy === 'update' && 'animate-spin')} aria-hidden="true" /> Fill in again from ConsolFlora
                    </Button>
                  )}
                  {i.odoo_url && i.odoo_source !== 'demo' && (
                    <a href={i.odoo_url} target="_blank" rel="noopener" className={buttonVariants({ variant: 'outline' })}>
                      <ExternalLink aria-hidden="true" /> Open in Odoo<span className="sr-only"> (new tab)</span>
                    </a>
                  )}
                </div>
              )}
              {differences.length > 0 && (
                <Alert variant="warning" title="Odoo's copy differs from ConsolFlora's">
                  <ul className="list-disc pl-5">
                    {differences.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  {state === 'draft' ? 'Fill in again from ConsolFlora to put ConsolFlora\'s values back, or keep Odoo\'s.' : 'Reset to draft to change it.'}
                </Alert>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>From ConsolFlora</CardTitle>
              <CardDescription>What ConsolFlora sends to Odoo. No farm, grower price or margin leaves ConsolFlora.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Buyer</dt>
                <dd>
                  {i.customers?.company_name} ({i.customers?.customer_code})
                </dd>
                <dt className="text-muted-foreground">{credit ? 'Credit' : 'Total'}</dt>
                <dd className="tabular-nums font-semibold">{money(i.amount, i.currency)}</dd>
                <dt className="text-muted-foreground">MAWB</dt>
                <dd>{p?.mawb || '—'}</dd>
                <dt className="text-muted-foreground">Proforma no.</dt>
                <dd className="break-words">{p?.proforma || '—'}</dd>
                <dt className="text-muted-foreground">Flight</dt>
                <dd>{p?.flight || '—'}</dd>
                <dt className="text-muted-foreground">Payment terms</dt>
                <dd>
                  {i.customers?.payment_terms}
                  {p?.due_date ? (
                    <span className="block">Due {day(p.due_date)} (the 15th of the month after the order was placed)</span>
                  ) : (
                    p && !p.payment_term_id && <span className="block text-muted-foreground">Not matched to an Odoo payment term yet (Odoo settings).</span>
                  )}
                </dd>
                {i.shipment_id && (
                  <>
                    <dt className="text-muted-foreground">Shipment</dt>
                    <dd>
                      <Link to="/shipments/$shipmentId" params={{ shipmentId: i.shipment_id }} className="font-semibold underline underline-offset-2">
                        Open shipment
                      </Link>
                    </dd>
                  </>
                )}
              </dl>
              {p && !Object.keys(p.field_map ?? {}).length && (
                <p className="mt-3 text-sm text-muted-foreground">
                  The MAWB, proforma and flight are not going into Odoo fields yet. An Admin chooses the fields on{' '}
                  <Link to="/settings/odoo" className="font-semibold underline">
                    Odoo settings
                  </Link>
                  .
                </p>
              )}
            </CardContent>
          </Card>
          <InvoiceEmailsCard invoiceId={i.id} />
        </div>
        <InvoicePreview loadPdf={() => odooInvoicePdf(i.id)} makePdf={() => makePdfInOdoo({ invoiceId: i.id })} onPdfMade={refresh} loading={inOdoo && odoo.isLoading} detail={d} reason={inOdoo ? (odoo.data?.reason ?? (odoo.error as Error | null)?.message ?? null) : 'Not in Odoo yet: the preview shows once Odoo has it.'} currency={i.currency} credit={credit} fixedDue={!!p?.due_date} />
      </div>
      <Dialog
        open={asking === 'confirm'}
        onClose={() => setAsking(null)}
        title={`Confirm this ${noun}?`}
        description={`${i.customers?.company_name}, ${money(d?.amount_total ?? i.amount, i.currency)}. Odoo gives it its number and today's date${credit ? '' : ', and the buyer is told'}.`}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button onClick={() => void act('confirm')}>Confirm</Button>
        </div>
      </Dialog>
      <Dialog
        open={asking === 'reset'}
        onClose={() => setAsking(null)}
        title="Reset to draft?"
        description={`${d?.name || i.odoo_name} goes back to draft in Odoo so it can be changed; buyers don't see drafts. Confirm it again when it is right.`}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button onClick={() => void act('reset')}>Reset to draft</Button>
        </div>
      </Dialog>
    </>
  )
}
