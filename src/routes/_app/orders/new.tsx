import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { createOrder, orderKeys, useReferenceData, useShipments } from '~/lib/orders/api'
import { ProductOptions } from '~/components/orders/product-options'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { formatDate } from '~/components/orders/shipment-status'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Label, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { STAFF_ROLES } from '~/lib/roles'

export const Route = createFileRoute('/_app/orders/new')({
  head: () => ({ meta: [{ title: 'New order · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={STAFF_ROLES}>
      <NewOrderPage />
    </RequireRole>
  ),
})

interface LineDraft {
  key: number
  productId: string
  stems: string
  notes: string
}

function NewOrderPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ref = useReferenceData()
  const shipments = useShipments()
  const [buyerId, setBuyerId] = React.useState('')
  const [shipmentId, setShipmentId] = React.useState('')
  const [date, setDate] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [lines, setLines] = React.useState<LineDraft[]>([{ key: 1, productId: '', stems: '', notes: '' }])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const nextKey = React.useRef(2)

  if (ref.isLoading) return <Spinner />
  const buyer = ref.data?.buyers.find((b) => b.id === buyerId)
  const openShipments = (shipments.data ?? []).filter((s) => s.status === 'open')
  const update = (key: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!buyerId) return setError('Choose the buyer.')
    const filled = lines.filter((l) => l.productId || l.stems)
    if (!filled.length) return setError('Add at least one line.')
    const bad = filled.findIndex((l) => !l.productId || !/^\d+$/.test(l.stems.trim()) || Number(l.stems) <= 0)
    if (bad >= 0) return setError(`Line ${bad + 1}: choose a product and a whole number of stems.`)
    setBusy(true)
    setError(null)
    try {
      const r = await createOrder({
        customerId: buyerId,
        shipmentId: shipmentId || null,
        farmDeliveryDate: date || null,
        notes,
        lines: filled.map((l) => ({ product_id: l.productId, stems: Number(l.stems), notes: l.notes.trim() || undefined })),
      })
      void queryClient.invalidateQueries({ queryKey: orderKeys.all })
      void navigate({ to: '/orders/$orderId', params: { orderId: r.order_id } })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="New order" description="Enter an order for a buyer, for example one taken by phone or email." />
      <form onSubmit={submit} className="grid grid-cols-1 gap-4" noValidate>
        {error && <Alert variant="destructive" title={error} role="alert" />}
        <Card>
          <CardHeader>
            <CardTitle>Buyer and shipment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field id="buyer" label="Buyer" hint={buyer ? `${buyer.incoterm} · ${buyer.currency} · to ${buyer.destination_airport}` : undefined}>
              {(d) => (
                <Select id="buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)} aria-describedby={d} required>
                  <option value="">Choose a buyer…</option>
                  {ref.data?.buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.company_name} ({b.customer_code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="shipment" label="Shipment" hint="Can be set later.">
              {(d) => (
                <Select id="shipment" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} aria-describedby={d}>
                  <option value="">Not yet</option>
                  {openShipments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shipment_ref} · {s.flight_no ?? 'flight not set'} · {formatDate(s.flight_date)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="delivery" label="Farms deliver on">
              {(d) => <Input id="delivery" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-describedby={d} />}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lines</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {lines.map((l, i) => (
              <fieldset key={l.key} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,14rem)_auto] sm:items-end">
                <legend className="sr-only">Line {i + 1}</legend>
                <div className="grid gap-1">
                  <Label htmlFor={`product-${l.key}`}>Product</Label>
                  <Select id={`product-${l.key}`} value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value })}>
                    <option value="">Choose a product…</option>
                    <ProductOptions products={ref.data?.products ?? []} />
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`stems-${l.key}`}>Stems</Label>
                  <Input id={`stems-${l.key}`} inputMode="numeric" value={l.stems} onChange={(e) => update(l.key, { stems: e.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`notes-${l.key}`}>Notes</Label>
                  <Input id={`notes-${l.key}`} value={l.notes} placeholder="e.g. Bunching by 3" onChange={(e) => update(l.key, { notes: e.target.value })} />
                </div>
                <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length === 1}>
                  <Trash2 aria-hidden="true" />
                  <span className="sr-only">Remove line {i + 1}</span>
                </Button>
              </fieldset>
            ))}
            <Button variant="outline" className="justify-self-start" onClick={() => setLines((ls) => [...ls, { key: nextKey.current++, productId: '', stems: '', notes: '' }])}>
              <Plus aria-hidden="true" /> Add a line
            </Button>
            <div className="grid gap-1">
              <Label htmlFor="order-notes">Notes for the whole order (optional)</Label>
              <Input id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Creating…' : 'Create order'}
          </Button>
        </div>
      </form>
    </>
  )
}
