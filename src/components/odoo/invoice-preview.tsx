import * as React from 'react'
import { AlertTriangle, CheckCircle2, Download, FileText } from 'lucide-react'
import { paymentLabel } from '~/lib/odoo/api'
import type { MappedField, OdooMoveDetail } from '~/server/odoo/client'
import { cn } from '~/lib/utils'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { buttonVariants } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'

export const FIELD_LABEL: Record<MappedField, string> = { mawb: 'MAWB', proforma: 'Proforma invoice no.', flight: 'Flight number' }
export const day = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
/** Odoo's move types in words. */
export const MOVE_LABEL: Record<string, string> = { out_invoice: 'Invoice', out_refund: 'Credit note', in_invoice: 'Bill', in_refund: 'Refund' }

/** Odoo's PDF when Odoo has made one, otherwise a live preview built from Odoo's own data. */
export function InvoicePreview({ loadPdf, loading, detail, reason, currency, credit, fixedDue = false }: { loadPdf: () => Promise<{ name: string; base64: string } | null>; loading: boolean; detail: OdooMoveDetail | null; reason: string | null; currency: string; credit: boolean; fixedDue?: boolean }) {
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
      const r = await loadPdf()
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
          <LivePreview d={detail} currency={currency} credit={credit} fixedDue={fixedDue} />
        )}
      </CardContent>
    </Card>
  )
}

function LivePreview({ d, currency, credit, fixedDue }: { d: OdooMoveDetail; currency: string; credit: boolean; fixedDue: boolean }) {
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
          <dd>{draft && !fixedDue ? 'Worked out when confirmed' : day(d.due_date)}</dd>
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
