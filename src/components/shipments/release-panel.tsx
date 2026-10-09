import * as React from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, FileUp, Paperclip } from 'lucide-react'
import type { Shipment } from '~/lib/orders/api'
import {
  DOC_LABELS,
  approveShipmentDocument,
  openShipmentDocument,
  saveShipmentDocument,
  updateShipment,
  useShipmentRelease,
  type DocType,
  type ShipmentDocument,
} from '~/lib/ordering/api'
import { checkValue } from '~/lib/import/validate'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

/** Flight and AWB, typed in from the airline or freight agent. */
export function ShipmentDetailsForm({ shipment, canEdit, onSaved }: { shipment: Shipment; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast()
  const [awb, setAwb] = React.useState(shipment.mawb ?? '')
  const [flight, setFlight] = React.useState(shipment.flight_no ?? '')
  const [date, setDate] = React.useState(shipment.flight_date ?? '')
  const [dest, setDest] = React.useState(shipment.destination_airport ?? '')
  const [landed, setLanded] = React.useState(shipment.arrived_at ? toLocalInput(shipment.arrived_at) : '')
  const [error, setError] = React.useState<string | null>(null)
  const dirty = awb !== (shipment.mawb ?? '') || flight !== (shipment.flight_no ?? '') || date !== (shipment.flight_date ?? '') || dest !== (shipment.destination_airport ?? '')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    let mawb: string | null = null
    if (awb.trim()) {
      const c = checkValue({ key: 'MAWB', type: 'awb' }, awb.trim())
      if (!c.ok) return setError(c.message)
      mawb = String(c.value)
    }
    const d = dest.trim().toUpperCase()
    if (d && !/^[A-Z]{3}$/.test(d)) return setError('The destination must be a 3-letter airport code, such as NRT.')
    setError(null)
    try {
      await updateShipment(shipment.id, { mawb, flight_no: flight.trim() || null, flight_date: date || null, destination_airport: d || null })
      toast({ kind: 'success', title: 'Shipment details saved' })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Flight and air waybill</CardTitle>
        <CardDescription>The AWB number comes from the airline or your freight agent.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} noValidate className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id="shp-awb" label="AWB number" hint="e.g. 176-61540743">
              {(d) => <Input id="shp-awb" value={awb} disabled={!canEdit} onChange={(e) => setAwb(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="shp-flight-no" label="Flight">
              {(d) => <Input id="shp-flight-no" value={flight} disabled={!canEdit} onChange={(e) => setFlight(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="shp-flight-date" label="Flight date">
              {(d) => <Input id="shp-flight-date" type="date" value={date} disabled={!canEdit} onChange={(e) => setDate(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="shp-dest" label="Destination">
              {(d) => <Input id="shp-dest" value={dest} maxLength={3} disabled={!canEdit} onChange={(e) => setDest(e.target.value)} aria-describedby={d} />}
            </Field>
          </div>
          {shipment.status === 'closed' && (
            <div className="flex flex-wrap items-end gap-2">
              <Field id="shp-landed" label="Landed at (destination)" hint="Buyers' claim window starts here. Until it is set: the day after the flight, 08:00 Nairobi time.">
                {(d) => <Input id="shp-landed" type="datetime-local" value={landed} disabled={!canEdit} onChange={(e) => setLanded(e.target.value)} aria-describedby={d} />}
              </Field>
              {canEdit && (
                <Button
                  variant="outline"
                  disabled={landed === (shipment.arrived_at ? toLocalInput(shipment.arrived_at) : '')}
                  onClick={async () => {
                    try {
                      await updateShipment(shipment.id, { arrived_at: landed ? new Date(landed).toISOString() : null })
                      toast({ kind: 'success', title: 'Landing time saved' })
                      onSaved()
                    } catch (err) {
                      setError((err as Error).message)
                    }
                  }}
                >
                  Save landing time
                </Button>
              )}
            </div>
          )}
          {error && (
            <p className="text-sm font-semibold text-destructive" role="alert">
              {error}
            </p>
          )}
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" disabled={!dirty}>
                Save flight details
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

/** What each buyer on the shipment still needs before it can close: documents and payment. */
export function ReleasePanel({ shipmentId, buyerName, canEdit, onChanged }: { shipmentId: string; buyerName: (id: string) => string; canEdit: boolean; onChanged: () => void }) {
  const q = useShipmentRelease(shipmentId)
  if (q.isLoading) return <Spinner />
  if (!q.data) return null
  const { release, documents, blockers } = q.data
  const refresh = () => {
    void q.refetch()
    onChanged()
  }
  const doc = (customerId: string | null, type: DocType) => documents.find((d) => d.customer_id === customerId && d.doc_type === type)
  const shipmentRow = release.find((r) => r.customer_id === null)
  const buyerRows = release.filter((r) => r.customer_id !== null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Release</CardTitle>
        <CardDescription>
          {blockers.length === 0 ? (
            <span className="inline-flex items-center gap-1 font-semibold text-success">
              <CheckCircle2 className="size-4" aria-hidden="true" /> Cleared: the shipment can close.
            </span>
          ) : (
            `${blockers.length} ${blockers.length === 1 ? 'thing' : 'things'} to clear before the shipment closes.`
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {release.length === 0 && <p className="text-muted-foreground">No approved orders on this shipment yet.</p>}
        {shipmentRow && (
          <section aria-label="Whole shipment" className="grid gap-2">
            <h3 className="font-bold">Whole shipment</h3>
            <DocumentRow shipmentId={shipmentId} customerId={null} type="export_entry" doc={doc(null, 'export_entry')} canEdit={canEdit} onChanged={refresh} />
          </section>
        )}
        {buyerRows.map((r) => (
          <section key={r.customer_id} aria-label={buyerName(r.customer_id!)} className="grid gap-2 rounded-lg border p-3">
            <h3 className="flex flex-wrap items-center gap-2 font-bold">
              {buyerName(r.customer_id!)}
              <Badge>{r.is_prepaid ? 'Prepaid' : 'Credit'}</Badge>
            </h3>
            {r.unpaid_prepaid_orders.length > 0 && (
              <p className="flex items-start gap-1.5 text-sm font-semibold text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Waiting for payment: {r.unpaid_prepaid_orders.join(', ')}. Finance or
                Admin marks it paid on the order.
              </p>
            )}
            {r.over_credit_limit && (
              <p className="flex items-start gap-1.5 text-sm font-semibold text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Over the credit limit. This only warns; Finance or Admin can
                decline an order.
              </p>
            )}
            <DocumentRow shipmentId={shipmentId} customerId={r.customer_id} type="phyto" doc={doc(r.customer_id, 'phyto')} canEdit={canEdit} onChanged={refresh} />
            <DocumentRow shipmentId={shipmentId} customerId={r.customer_id} type="certificate_of_origin" doc={doc(r.customer_id, 'certificate_of_origin')} canEdit={canEdit} onChanged={refresh} />
          </section>
        ))}
      </CardContent>
    </Card>
  )
}

function DocumentRow({ shipmentId, customerId, type, doc, canEdit, onChanged }: { shipmentId: string; customerId: string | null; type: DocType; doc: ShipmentDocument | undefined; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [reference, setReference] = React.useState(doc?.reference ?? '')
  const [file, setFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState(false)
  const id = `doc-${customerId ?? 'shipment'}-${type}`

  return (
    <div className="grid gap-2 border-t pt-2 first-of-type:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-56 font-semibold">{DOC_LABELS[type]}</span>
        {!doc ? (
          <Badge>
            <CircleDashed aria-hidden="true" /> Missing
          </Badge>
        ) : doc.status === 'approved' ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden="true" /> Checked
          </Badge>
        ) : (
          <Badge variant="warning">
            <AlertTriangle aria-hidden="true" /> Not checked yet
          </Badge>
        )}
        {doc?.reference && <span className="text-sm">No. {doc.reference}</span>}
        {doc?.storage_path && (
          <Button size="sm" variant="ghost" onClick={() => openShipmentDocument(doc.storage_path!).catch((e) => toast({ kind: 'error', title: 'Can\'t open the file', description: (e as Error).message }))}>
            <Paperclip aria-hidden="true" /> Open file
          </Button>
        )}
        {canEdit && doc?.status === 'uploaded' && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await approveShipmentDocument(doc.id)
                toast({ kind: 'success', title: `${DOC_LABELS[type]} checked` })
                onChanged()
              } catch (e) {
                toast({ kind: 'error', title: 'Not done', description: (e as Error).message })
              } finally {
                setBusy(false)
              }
            }}
          >
            <CheckCircle2 aria-hidden="true" /> Mark checked
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id}>
            <FileUp aria-hidden="true" /> {doc ? 'Replace' : 'Add'}
          </Button>
        )}
      </div>
      {open && (
        <form
          id={id}
          className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await saveShipmentDocument({ shipmentId, customerId, docType: type, reference, file })
              toast({ kind: 'success', title: `${DOC_LABELS[type]} saved` })
              setOpen(false)
              setFile(null)
              onChanged()
            } catch (err) {
              toast({ kind: 'error', title: 'Not saved', description: (err as Error).message })
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field id={`${id}-ref`} label="Document number">
            {(d) => <Input id={`${id}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} aria-describedby={d} />}
          </Field>
          <Field id={`${id}-file`} label="File (PDF or photo)">
            {(d) => <Input id={`${id}-file`} type="file" accept="application/pdf,image/*" className="py-1.5" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-describedby={d} />}
          </Field>
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </form>
      )}
    </div>
  )
}

/** ISO time as the value of a datetime-local input, in this browser's time zone. */
function toLocalInput(iso: string) {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
