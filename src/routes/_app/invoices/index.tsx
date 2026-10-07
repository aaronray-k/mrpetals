import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Upload } from 'lucide-react'
import { fetchFromOdoo, invoiceNumber, pushToOdoo, useInvoices, useOdooSettings, useOdooStatus, type Invoice } from '~/lib/odoo/api'
import { cn, formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { InvoiceStatusBadge } from '~/components/odoo/invoice-status'
import { money } from '~/components/shop/money'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/invoices/')({
  head: () => ({ meta: [{ title: 'Invoices · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/invoices')}>
      <InvoicesPage />
    </RequireRole>
  ),
})

type Filter = 'drafts' | 'attention' | 'unpaid' | 'paid' | 'all'
const FILTERS: { key: Filter; label: string; test: (i: Invoice) => boolean }[] = [
  { key: 'drafts', label: 'Drafts to confirm', test: (i) => i.status === 'pushed' && i.odoo_state === 'draft' },
  { key: 'attention', label: 'Not in Odoo', test: (i) => i.status !== 'pushed' },
  { key: 'unpaid', label: 'Unpaid', test: (i) => i.status === 'pushed' && i.odoo_state === 'posted' && !['paid', 'reversed'].includes(i.odoo_payment_state ?? '') },
  { key: 'paid', label: 'Paid', test: (i) => ['paid', 'reversed'].includes(i.odoo_payment_state ?? '') },
  { key: 'all', label: 'All', test: () => true },
]

function InvoicesPage() {
  const invoices = useInvoices()
  const settings = useOdooSettings()
  const status = useOdooStatus()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [filter, setFilter] = React.useState<Filter>('drafts')
  const [busy, setBusy] = React.useState<'push' | 'fetch' | null>(null)
  const autoFetched = React.useRef(false)
  const refresh = () => {
    for (const k of ['invoices', 'odoo-settings', 'odoo-log']) void queryClient.invalidateQueries({ queryKey: [k] })
  }

  async function fetchNow(quiet = false) {
    setBusy('fetch')
    try {
      const r = await fetchFromOdoo()
      if (!quiet) toast({ kind: r.skipped ? 'error' : 'success', title: r.skipped ? 'Odoo not connected' : 'Fetched from Odoo', description: r.skipped ?? `${r.updated} invoices updated${r.failed ? `, ${r.failed} could not be read` : ''}.` })
      refresh()
    } catch (e) {
      if (!quiet) toast({ kind: 'error', title: 'Fetch failed', description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  // Odoo's payments come in when the page opens, if the last fetch is more than 10 minutes old.
  React.useEffect(() => {
    if (autoFetched.current || !settings.data || status.data?.source === 'none') return
    const last = settings.data.last_fetch_at ? Date.parse(settings.data.last_fetch_at) : 0
    if (Date.now() - last > 10 * 60_000) {
      autoFetched.current = true
      void fetchNow(true)
    }
  })

  const real = status.data?.source === 'api'
  const sendFrom = settings.data?.send_from ? Date.parse(settings.data.send_from) : null
  // Before go-live (or demo data on the preview): never sent to the real Odoo.
  const beforeGoLive = (i: Invoice) => real && i.status !== 'pushed' && sendFrom != null && Date.parse(i.created_at) < sendFrom
  const rows = (invoices.data ?? []).filter(FILTERS.find((f) => f.key === filter)!.test)
  const waiting = (invoices.data ?? []).filter((i) => i.status !== 'pushed' && !beforeGoLive(i)).length

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Invoices and credit notes are made in Odoo: one line, Cut Flowers, with the total in the buyer's currency."
        actions={
          <>
            <Button
              variant="outline"
              disabled={!!busy || status.data?.source === 'none'}
              onClick={() => void fetchNow()}
            >
              <RefreshCw className={cn(busy === 'fetch' && 'animate-spin')} aria-hidden="true" /> Refresh from Odoo
            </Button>
            <Button
              disabled={!!busy || !waiting || status.data?.source === 'none'}
              onClick={async () => {
                setBusy('push')
                try {
                  const r = await pushToOdoo()
                  toast({ kind: r.failed ? 'error' : 'success', title: `${r.pushed} sent to Odoo`, description: r.failed ? `${r.failed} failed; see the reasons below.` : undefined })
                  refresh()
                } catch (e) {
                  toast({ kind: 'error', title: 'Not sent', description: (e as Error).message })
                } finally {
                  setBusy(null)
                }
              }}
            >
              <Upload aria-hidden="true" /> Send waiting to Odoo ({waiting})
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="invoices.how" title="How invoicing works">
          When a shipment closes, each buyer on it gets one invoice for all their orders on that flight; claim credit notes become Odoo credit
          notes. They arrive in Odoo as drafts, with the MAWB, proforma numbers, flight and payment terms filled in. Open one to check it
          against Odoo's preview and <strong>Confirm</strong> it; the buyer is told once it is confirmed. Payments come back from Odoo, and a
          paid invoice marks its orders paid here.
        </Tip>
        {status.data?.source === 'none' && (
          <Alert variant="warning" title="Odoo is not connected">
            {status.data.reason} <Link to="/settings/odoo" className="font-semibold underline">Odoo settings</Link>
          </Alert>
        )}
        {status.data?.source === 'demo' && <p className="text-sm text-muted-foreground">Preview: invoices go to a demo Odoo, and the demo buyer pays each invoice a few minutes after it is confirmed.</p>}
        {settings.data?.last_fetch_at && <p className="text-sm text-muted-foreground">Last fetched from Odoo {formatDateTime(settings.data.last_fetch_at)}.</p>}
        <fieldset className="flex w-fit flex-wrap gap-1 rounded-md border border-input bg-card p-1">
          <legend className="sr-only">Show</legend>
          {FILTERS.map((f) => (
            <label key={f.key} className={cn('inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', filter === f.key && 'bg-accent/20')}>
              <input type="radio" name="invoice-filter" className="sr-only" checked={filter === f.key} onChange={() => setFilter(f.key)} />
              {f.label} ({(invoices.data ?? []).filter(f.test).length})
            </label>
          ))}
        </fieldset>
        {invoices.isLoading && <Spinner />}
        {invoices.error && <Alert variant="destructive" title="Couldn't load invoices" role="alert">{(invoices.error as Error).message}</Alert>}
        {invoices.data && (
          <Card>
            <Table>
              <caption className="sr-only">Invoices</caption>
              <THead>
                <TR>
                  <TH>Odoo number</TH>
                  <TH>Buyer</TH>
                  <TH>Reference</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Still due</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((i) => (
                  <TR key={i.id}>
                    <TD className="whitespace-nowrap">
                      <Link to="/invoices/$invoiceId" params={{ invoiceId: i.id }} className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
                        {invoiceNumber(i)}
                      </Link>
                    </TD>
                    <TD>{i.customers?.company_name}</TD>
                    <TD>
                      {i.kind === 'credit_note' && <span className="font-semibold">Credit note · </span>}
                      {i.reference}
                      {i.last_error && i.status === 'failed' && <span className="block text-sm text-destructive">{i.last_error}</span>}
                    </TD>
                    <TD className="text-right tabular-nums">{money(i.kind === 'credit_note' ? -i.amount : i.amount, i.currency)}</TD>
                    <TD className="text-right tabular-nums">{i.odoo_amount_due == null ? '—' : money(i.odoo_amount_due, i.currency)}</TD>
                    <TD>
                      {beforeGoLive(i) ? (
                        <Badge>Before Odoo go-live: not sent</Badge>
                      ) : (
                        <InvoiceStatusBadge invoice={i} />
                      )}
                      {real && i.odoo_source === 'demo' && <Badge className="ml-1">Demo Odoo</Badge>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {rows.length === 0 && <p className="p-4 text-muted-foreground">Nothing here.</p>}
          </Card>
        )}
      </div>
    </>
  )
}
