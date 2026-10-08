import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Download, ExternalLink, FileText, Plane, ReceiptText, Search } from 'lucide-react'
import { findShipments, useRecentShipments, useShipmentDocuments, type ShipmentRef } from '~/lib/documents/api'
import { proformaPdfFile } from '~/lib/invoices/api'
import { invoiceNumber, odooInvoicePdf, type Invoice } from '~/lib/odoo/api'
import { cn } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { day } from '~/components/odoo/invoice-preview'
import { InvoiceStatusBadge } from '~/components/odoo/invoice-status'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'

export const Route = createFileRoute('/_app/documents')({
  head: () => ({ meta: [{ title: 'Shipment documents · ConsolFlora' }] }),
  validateSearch: (s: Record<string, unknown>): { shipment?: string } => (typeof s.shipment === 'string' ? { shipment: s.shipment } : {}),
  component: () => (
    <RequireRole roles={rolesFor('/documents')}>
      <DocumentsPage />
    </RequireRole>
  ),
})

type Selected = { kind: 'proforma'; orderId: string; label: string } | { kind: 'invoice'; invoice: Invoice; label: string }
const shipmentLabel = (s: ShipmentRef) => [s.shipment_ref, s.mawb && `MAWB ${s.mawb}`, s.flight_no, s.flight_date && day(s.flight_date)].filter(Boolean).join(' · ')

/** Everything under one shipment, found by picking it or by its MAWB, a proforma invoice no., or an invoice number. */
function DocumentsPage() {
  const { shipment } = Route.useSearch()
  const navigate = useNavigate()
  const recent = useRecentShipments()
  const docs = useShipmentDocuments(shipment)
  const [text, setText] = React.useState('')
  const [matches, setMatches] = React.useState<ShipmentRef[] | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Selected | null>(null)
  const open = (id: string) => {
    setSelected(null)
    void navigate({ to: '/documents', search: { shipment: id } })
  }

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setSearchError(null)
    if (!text.trim()) return
    setSearching(true)
    try {
      const found = await findShipments(text)
      if (found.length === 1) {
        setMatches(null)
        open(found[0]!.id)
      } else setMatches(found)
    } catch (err) {
      setSearchError((err as Error).message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <>
      <PageHeader title="Shipment documents" description="Pick a shipment, or find it by its MAWB or a Proforma Invoice No. (e.g. CFLPFJ0089), to see every document under it." />
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardContent className="grid gap-4 pt-6 lg:grid-cols-2">
            <form role="search" onSubmit={search} className="grid gap-2">
              <label htmlFor="doc-search" className="text-sm font-semibold">
                MAWB, Proforma Invoice No., shipment or invoice number
              </label>
              <div className="flex flex-wrap gap-2">
                <Input id="doc-search" type="search" className="min-w-0 flex-1" placeholder="e.g. 176-61541003 or CFLPFJ0089" value={text} onChange={(e) => setText(e.target.value)} />
                <Button type="submit" disabled={searching}>
                  <Search aria-hidden="true" /> {searching ? 'Finding…' : 'Find'}
                </Button>
              </div>
            </form>
            <div className="grid gap-2">
              <label htmlFor="doc-shipment" className="text-sm font-semibold">
                Or pick a shipment
              </label>
              <Select id="doc-shipment" value={shipment ?? ''} onChange={(e) => e.target.value && open(e.target.value)}>
                <option value="">Choose…</option>
                {(recent.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {shipmentLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>
        {searchError && <Alert variant="destructive" title="Couldn't search" role="alert">{searchError}</Alert>}
        {matches && (
          <Alert title={matches.length ? `${matches.length} shipments match "${text.trim()}"` : `No shipment matches "${text.trim()}"`} role="status">
            {matches.length > 0 && (
              <ul className="mt-2 grid gap-1">
                {matches.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="min-h-6 font-semibold underline underline-offset-2" onClick={() => (setMatches(null), open(s.id))}>
                      {shipmentLabel(s)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {docs.isLoading && <Spinner />}
        {docs.error && <Alert variant="destructive" title="Couldn't load the documents" role="alert">{(docs.error as Error).message}</Alert>}
        {docs.data && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="grid content-start gap-4">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <Plane className="size-5" aria-hidden="true" /> {docs.data.shipment.shipment_ref}
                    </CardTitle>
                    <Badge variant={docs.data.shipment.status === 'closed' ? 'success' : 'default'}>{docs.data.shipment.status === 'closed' ? 'Closed' : 'Open'}</Badge>
                  </div>
                  <CardDescription>
                    MAWB <strong>{docs.data.shipment.mawb ?? 'not set'}</strong> · Flight {docs.data.shipment.flight_no ?? '—'} · {day(docs.data.shipment.flight_date)}
                    {docs.data.shipment.destination_airport && ` · to ${docs.data.shipment.destination_airport}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link to="/shipments/$shipmentId" params={{ shipmentId: docs.data.shipment.id }} className="text-sm font-semibold underline underline-offset-2">
                    Open the shipment
                  </Link>
                </CardContent>
              </Card>
              {docs.data.buyers.length === 0 && <p className="text-muted-foreground">No orders on this shipment yet.</p>}
              {docs.data.buyers.map((b) => (
                <Card key={b.customer_id}>
                  <CardHeader>
                    <CardTitle className="text-lg">{b.company_name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="grid gap-2">
                      {b.orders.map((o) => (
                        <DocRow
                          key={o.id}
                          icon={<FileText className="size-4" aria-hidden="true" />}
                          title={`Proforma & Packing List ${o.order_number}`}
                          detail={o.status === 'cancelled' ? 'Order cancelled' : 'Proforma Invoice No. ' + o.order_number}
                          active={selected?.kind === 'proforma' && selected.orderId === o.id}
                          onOpen={() => setSelected({ kind: 'proforma', orderId: o.id, label: `Proforma & Packing List ${o.order_number}` })}
                        />
                      ))}
                      {b.invoices.map((i) => (
                        <DocRow
                          key={i.id}
                          icon={<ReceiptText className="size-4" aria-hidden="true" />}
                          title={`${i.kind === 'credit_note' ? 'Credit note' : 'Odoo invoice'} ${invoiceNumber(i)}`}
                          detail={
                            <span className="flex flex-wrap items-center gap-2">
                              {money(i.kind === 'credit_note' ? -i.amount : i.amount, i.currency)} <InvoiceStatusBadge invoice={i} />
                            </span>
                          }
                          active={selected?.kind === 'invoice' && selected.invoice.id === i.id}
                          onOpen={() => setSelected({ kind: 'invoice', invoice: i, label: `${i.kind === 'credit_note' ? 'Credit note' : 'Invoice'} ${invoiceNumber(i)}` })}
                        />
                      ))}
                      {b.invoices.length === 0 && (
                        <li className="text-sm text-muted-foreground">{docs.data!.shipment.status === 'closed' ? 'No invoice.' : 'The invoice is made when the shipment closes.'}</li>
                      )}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
            <DocPreview selected={selected} />
          </div>
        )}
        {!shipment && !matches && <p className="text-muted-foreground">Choose a shipment to see its documents.</p>}
      </div>
    </>
  )
}

function DocRow({ icon, title, detail, active, onOpen }: { icon: React.ReactNode; title: string; detail: React.ReactNode; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={active}
        className={cn('grid w-full gap-0.5 rounded-md border p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'border-primary bg-accent/10')}
      >
        <span className="flex items-center gap-2 font-semibold">
          {icon} {title}
        </span>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </button>
    </li>
  )
}

/** The chosen document, shown on the side: the Proforma & Packing List PDF, or Odoo's invoice PDF. */
function DocPreview({ selected }: { selected: Selected | null }) {
  const pdf = usePdf(selected)
  return (
    <Card className="min-w-0 xl:sticky xl:top-4 xl:self-start">
      <CardHeader>
        <CardTitle>{selected?.label ?? 'Preview'}</CardTitle>
        {!selected && <CardDescription>Choose a document to see it here.</CardDescription>}
      </CardHeader>
      {selected && (
        <CardContent className="grid gap-3">
          {pdf.loading ? (
            <Spinner />
          ) : pdf.error ? (
            <Alert variant="warning" title="No PDF to show">
              {pdf.error}
            </Alert>
          ) : pdf.file ? (
            <>
              <iframe src={pdf.file.url} title={selected.label} className="h-[75vh] w-full rounded border" />
              <div className="flex flex-wrap gap-2">
                <a href={pdf.file.url} download={pdf.file.name} className={buttonVariants({ variant: 'outline' })}>
                  <Download aria-hidden="true" /> Download
                </a>
                {selected.kind === 'invoice' && (
                  <Link to="/invoices/$invoiceId" params={{ invoiceId: selected.invoice.id }} className={buttonVariants({ variant: 'outline' })}>
                    <ExternalLink aria-hidden="true" /> Open the invoice
                  </Link>
                )}
              </div>
            </>
          ) : null}
          {selected.kind === 'invoice' && !pdf.file && !pdf.loading && (
            <Link to="/invoices/$invoiceId" params={{ invoiceId: selected.invoice.id }} className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}>
              <ExternalLink aria-hidden="true" /> Open the invoice (live preview, Confirm, Make Odoo's PDF)
            </Link>
          )}
        </CardContent>
      )}
    </Card>
  )
}

/** Loads the chosen document's PDF into an object URL (freed when another is chosen). */
function usePdf(selected: Selected | null) {
  const [state, setState] = React.useState<{ loading: boolean; error: string | null; file: { url: string; name: string } | null }>({ loading: false, error: null, file: null })
  const key = selected ? (selected.kind === 'proforma' ? `p:${selected.orderId}` : `i:${selected.invoice.id}`) : ''
  React.useEffect(() => {
    if (!selected) return setState({ loading: false, error: null, file: null })
    let url: string | null = null
    let cancelled = false
    setState({ loading: true, error: null, file: null })
    const load = async () => {
      if (selected.kind === 'proforma') return proformaPdfFile(selected.orderId)
      if (selected.invoice.status !== 'pushed') throw new Error('This invoice isn\'t in Odoo yet.')
      const r = await odooInvoicePdf(selected.invoice.id)
      if (!r) throw new Error(selected.invoice.odoo_state === 'draft' ? 'A draft: Odoo makes its PDF once the invoice is confirmed.' : "Odoo hasn't made its PDF of this invoice yet.")
      return r
    }
    load()
      .then((r) => {
        if (cancelled) return
        const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))
        url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setState({ loading: false, error: null, file: { url, name: r.name } })
      })
      .catch((e: Error) => !cancelled && setState({ loading: false, error: e.message, file: null }))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

