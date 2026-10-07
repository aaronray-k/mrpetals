import { AlertTriangle, Ban, CheckCircle2, Clock, FilePen, Upload } from 'lucide-react'
import { invoiceNumber, paymentLabel, type Invoice } from '~/lib/odoo/api'
import { Badge } from '~/components/ui/badge'

/** Where an invoice stands, in words with an icon. */
export function InvoiceStatusBadge({ invoice }: { invoice: Pick<Invoice, 'status' | 'odoo_payment_state' | 'odoo_state' | 'kind'> }) {
  if (invoice.status === 'pending')
    return (
      <Badge variant="warning">
        <Upload aria-hidden="true" /> Waiting to go to Odoo
      </Badge>
    )
  if (invoice.status === 'failed')
    return (
      <Badge variant="destructive">
        <AlertTriangle aria-hidden="true" /> Not in Odoo
      </Badge>
    )
  if (invoice.odoo_state === 'draft')
    return (
      <Badge variant="warning">
        <FilePen aria-hidden="true" /> Draft: to confirm
      </Badge>
    )
  if (invoice.odoo_state === 'cancel')
    return (
      <Badge>
        <Ban aria-hidden="true" /> Cancelled in Odoo
      </Badge>
    )
  const settled = invoice.odoo_payment_state === 'paid' || invoice.odoo_payment_state === 'reversed'
  return (
    <Badge variant={settled ? 'success' : 'default'}>
      {settled ? <CheckCircle2 aria-hidden="true" /> : <Clock aria-hidden="true" />} {invoice.kind === 'credit_note' && settled ? 'Applied' : paymentLabel(invoice.odoo_payment_state)}
    </Badge>
  )
}

/** The Odoo invoice(s) for a shipment, an order or a credit note, in one line each. */
export function InvoiceLines({ invoices, showBuyer = false }: { invoices: Invoice[]; showBuyer?: boolean }) {
  if (!invoices.length) return null
  return (
    <ul className="grid gap-2">
      {invoices.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{invoiceNumber(i)}</span>
          {showBuyer && <span>{i.customers?.company_name}</span>}
          <span className="tabular-nums">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: i.currency }).format(i.kind === 'credit_note' ? -i.amount : i.amount)}</span>
          <InvoiceStatusBadge invoice={i} />
          {i.status === 'failed' && i.last_error && <span className="text-sm text-destructive">{i.last_error}</span>}
        </li>
      ))}
    </ul>
  )
}
