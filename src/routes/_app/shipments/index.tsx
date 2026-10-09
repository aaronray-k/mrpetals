import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Plane, Plus } from 'lucide-react'
import { createShipment, shipmentKeys, useShipments } from '~/lib/orders/api'
import { checkValue } from '~/lib/import/validate'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Tip } from '~/components/tips/tips'
import { ShipmentStatus, formatDate } from '~/components/orders/shipment-status'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export const Route = createFileRoute('/_app/shipments/')({
  head: () => ({ meta: [{ title: 'Shipments · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/shipments')}>
      <ShipmentsPage />
    </RequireRole>
  ),
})

function ShipmentsPage() {
  const { roles } = useAuth()
  const shipments = useShipments()
  const [open, setOpen] = React.useState(false)
  const staff = hasAnyRole(roles, STAFF_ROLES)

  return (
    <>
      <PageHeader
        title="Shipments"
        description="One shipment is one flight. Orders go on a shipment; boxes are numbered per buyer."
        actions={
          staff && (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden="true" /> New shipment
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="shipments.list" title="Shipments and box numbers">
          Each buyer's boxes on a shipment are numbered <strong>1 to N</strong>. Numbers close up when a box is voided,
          until you <strong>close the shipment</strong>: then they never change again.
        </Tip>
        {shipments.isLoading && <Spinner />}
        {shipments.error && <Alert variant="destructive" title="Couldn't load shipments" role="alert">{(shipments.error as Error).message}</Alert>}
        {shipments.data?.length === 0 && (
          <Card className="grid justify-items-start gap-2 p-6">
            <Plane className="size-8 text-accent" aria-hidden="true" />
            <p className="text-lg font-bold">No shipments yet</p>
            <p className="text-muted-foreground">Create one for each flight, then put orders on it.</p>
          </Card>
        )}
        {!!shipments.data?.length && (
          <Card>
            <Table>
              <caption className="sr-only">Shipments</caption>
              <THead>
                <TR>
                  <TH>Shipment</TH>
                  <TH>Flight</TH>
                  <TH>Date</TH>
                  <TH>Route</TH>
                  <TH>MAWB</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {shipments.data.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link to="/shipments/$shipmentId" params={{ shipmentId: s.id }} className="inline-flex min-h-6 items-center font-semibold underline-offset-2 hover:underline">
                        {s.shipment_ref}
                      </Link>
                    </TD>
                    <TD>{s.flight_no ?? '—'}</TD>
                    <TD className="whitespace-nowrap">{formatDate(s.flight_date)}</TD>
                    <TD>
                      {s.origin_airport} → {s.destination_airport ?? '?'}
                    </TD>
                    <TD className="font-mono text-sm">{s.mawb ?? '—'}</TD>
                    <TD>
                      <ShipmentStatus status={s.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </div>
      <NewShipmentDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function NewShipmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = React.useState({ ref: '', flight: '', date: '', dest: '', mawb: '' })
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  React.useEffect(() => {
    if (open) {
      setForm({ ref: `SHP-${new Date().getFullYear()}-`, flight: '', date: '', dest: '', mawb: '' })
      setError(null)
    }
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const dest = form.dest.trim().toUpperCase()
    if (form.ref.trim().length < 3) return setError('Give the shipment a reference.')
    if (dest && !/^[A-Z]{3}$/.test(dest)) return setError('The destination must be a 3-letter airport code, such as NRT.')
    let mawb: string | null = null
    if (form.mawb.trim()) {
      const check = checkValue({ key: 'MAWB', type: 'awb' }, form.mawb.trim())
      if (!check.ok) return setError(check.message)
      mawb = String(check.value)
    }
    setBusy(true)
    setError(null)
    try {
      const id = await createShipment({
        shipment_ref: form.ref.trim(),
        flight_no: form.flight.trim() || null,
        flight_date: form.date || null,
        destination_airport: dest || null,
        mawb,
      })
      void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
      onClose()
      void navigate({ to: '/shipments/$shipmentId', params: { shipmentId: id } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New shipment">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {error && <Alert variant="destructive" title={error} role="alert" />}
        <Field id="shp-ref" label="Shipment reference">
          {(d) => <Input id="shp-ref" value={form.ref} onChange={set('ref')} aria-describedby={d} required />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="shp-flight" label="Flight" hint="e.g. EK 720">
            {(d) => <Input id="shp-flight" value={form.flight} onChange={set('flight')} aria-describedby={d} />}
          </Field>
          <Field id="shp-date" label="Flight date">
            {(d) => <Input id="shp-date" type="date" value={form.date} onChange={set('date')} aria-describedby={d} />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="shp-dest" label="Destination airport" hint="3 letters, e.g. NRT">
            {(d) => <Input id="shp-dest" value={form.dest} maxLength={3} onChange={set('dest')} aria-describedby={d} className="uppercase" />}
          </Field>
          <Field id="shp-mawb" label="MAWB (optional)" hint="e.g. 176-61540743">
            {(d) => <Input id="shp-mawb" value={form.mawb} onChange={set('mawb')} aria-describedby={d} />}
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create shipment'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
