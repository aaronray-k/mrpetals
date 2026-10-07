import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, ExternalLink, FileText, RefreshCw, RotateCcw, Upload } from 'lucide-react'
import { invoiceNumber, odooInvoiceAction, odooInvoicePdf, paymentLabel, pushToOdoo, useInvoice, useOdooInvoice, useOdooStatus } from '~/lib/odoo/api'
import type { MappedField, OdooMoveDetail } from '~/server/odoo/client'
import { cn, formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
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

const FIELD_LABEL: Record<MappedField, string> = { mawb: 'MAWB', proforma: 'Proforma invoice no.', flight: 'Flight number' }
const day = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
type Action = 'confirm' | 'reset' | 'update'

function InvoicePage() {
  const { invoiceId } = Route.useParams()
  const invoice = useInvoice(invoiceId)
  const status = useOdooStatus()
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
          description: action === 'confirm' && invoice.data?.kind === 'invoice' ? 'The buyer has been told.' : undefined,
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
              {i.status !== 'pushed' && (
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
                  {p && !p.payment_term_id && <span className="block text-muted-foreground">Not matched to an Odoo payment term yet (Odoo settings).</span>}
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
        </div>
        <Preview invoiceId={i.id} loading={inOdoo && odoo.isLoading} detail={d} reason={inOdoo ? (odoo.data?.reason ?? (odoo.error as Error | null)?.message ?? null) : 'Not in Odoo yet: the preview shows once Odoo has it.'} currency={i.currency} credit={credit} />
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

/** Odoo's PDF when Odoo has made one, otherwise a live preview built from Odoo's own data. */
function Preview({ invoiceId, loading, detail, reason, currency, credit }: { invoiceId: string; loading: boolean; detail: OdooMoveDetail | null; reason: string | null; currency: string; credit: boolean }) {
  const [view, setView] = React.useState<'live' | 'pdf'>('live')
  const [pdf, setPdf] = React.useState<{ url: string; name: string } | 'none' | 'loading' | null>(null)
  React.useEffect(() => () => {
    if (pdf && typeof pdf === 'object') URL.revokeObjectURL(pdf.url)
  }, [pdf])

  async function openPdf() {
    setView('pdf')
    if (pdf && pdf !== 'none') return
    setPdf('loading')
    try {
      const r = await odooInvoicePdf(invoiceId)
      if (!r) return setPdf('none')
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))
      setPdf({ url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), name: r.name })
    } catch {
      setPdf('none')
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Preview</CardTitle>
          {detail?.has_pdf && (
            <fieldset className="flex flex-wrap gap-1 rounded-md border border-input p-1">
              <legend className="sr-only">Show</legend>
              {(['live', 'pdf'] as const).map((v) => (
                <label key={v} className={cn('inline-flex h-8 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', view === v && 'bg-accent/20')}>
                  <input type="radio" name="invoice-preview" className="sr-only" checked={view === v} onChange={() => (v === 'pdf' ? void openPdf() : setView('live'))} />
                  {v === 'live' ? 'Live from Odoo' : "Odoo's PDF"}
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <CardDescription>
          {detail?.has_pdf ? "As Odoo has it now. Odoo's PDF is the one it made when the invoice was printed or sent." : 'As Odoo has it now. Odoo makes its PDF when the invoice is printed or sent from Odoo.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner />
        ) : !detail ? (
          <Alert variant="warning" title="No preview">
            {reason}
          </Alert>
        ) : view === 'pdf' ? (
          pdf === 'loading' || pdf == null ? (
            <Spinner />
          ) : pdf === 'none' ? (
            <Alert title="Odoo has no PDF of this invoice." />
          ) : (
            <div className="grid gap-2">
              <iframe src={pdf.url} title={`Odoo's PDF: ${pdf.name}`} className="h-[70vh] w-full rounded border" />
              <a href={pdf.url} download={pdf.name} className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}>
                <Download aria-hidden="true" /> Download PDF
              </a>
            </div>
          )
        ) : (
          <LivePreview d={detail} currency={currency} credit={credit} />
        )}
      </CardContent>
    </Card>
  )
}

function LivePreview({ d, currency, credit }: { d: OdooMoveDetail; currency: string; credit: boolean }) {
  const draft = d.state === 'draft'
  return (
    <article aria-label="Invoice preview" className="relative grid gap-5 overflow-hidden rounded-md border bg-white p-4 text-sm text-neutral-900 sm:p-6">
      {draft && (
        <span aria-hidden="true" className="pointer-events-none absolute right-4 top-4 rotate-6 rounded border-2 border-amber-600 px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-amber-700">
          Draft
        </span>
      )}
      <header className="grid gap-1">
        <p className="font-semibold">{d.company}</p>
        <h2 className="text-xl font-bold">
          {draft ? `Draft ${credit ? 'credit note' : 'invoice'}` : `${credit ? 'Credit note' : 'Invoice'} ${d.name}`}
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-500">{credit ? 'Credit to' : 'Bill to'}</p>
          <p className="font-semibold">{d.partner}</p>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-neutral-500">Invoice date</dt>
          <dd>{draft ? 'When confirmed' : day(d.invoice_date)}</dd>
          <dt className="text-neutral-500">Due date</dt>
          <dd>{draft ? 'Worked out when confirmed' : day(d.due_date)}</dd>
          <dt className="text-neutral-500">Payment terms</dt>
          <dd>{d.payment_term ?? '—'}</dd>
          <dt className="text-neutral-500">Reference</dt>
          <dd className="break-words">{d.reference ?? '—'}</dd>
          {d.fields.map((f) => (
            <React.Fragment key={f.key}>
              <dt className="text-neutral-500">{FIELD_LABEL[f.key]}</dt>
              <dd className="break-words">{f.value ?? '—'}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Invoice lines</caption>
          <thead>
            <tr className="border-b border-neutral-300 text-neutral-500">
              <th scope="col" className="py-1.5 pr-2 font-semibold">Description</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Qty</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Price</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, n) => (
              <tr key={n} className="border-b border-neutral-200">
                <td className="py-1.5 pr-2">{l.name}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.price_unit, currency)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(l.subtotal, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt className="text-neutral-500">Untaxed amount</dt>
        <dd className="text-right tabular-nums">{money(d.amount_untaxed, currency)}</dd>
        <dt className="text-neutral-500">Tax</dt>
        <dd className="text-right tabular-nums">{money(d.amount_tax, currency)}</dd>
        <dt className="border-t border-neutral-300 pt-1 font-bold">Total</dt>
        <dd className="border-t border-neutral-300 pt-1 text-right font-bold tabular-nums">{money(d.amount_total, currency)}</dd>
        {!draft && (
          <>
            <dt className="text-neutral-500">Still due</dt>
            <dd className="text-right tabular-nums">{money(d.amount_due, currency)}</dd>
          </>
        )}
      </dl>
      {!draft && (
        <p className="flex items-center gap-1 text-neutral-600">
          {d.payment_state === 'paid' ? <CheckCircle2 className="size-4" aria-hidden="true" /> : d.payment_state === 'not_paid' ? <FileText className="size-4" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
          {paymentLabel(d.payment_state)}
        </p>
      )}
    </article>
  )
}
