import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { placeOrder, useCart, useCatalog, useFlights, useOrderingSettings } from '~/lib/ordering/api'
import { serviceFeeText, useMyService } from '~/lib/fees/api'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { CartLineEditor } from '~/components/shop/cart-line-editor'
import { money } from '~/components/shop/money'
import { formatDate } from '~/components/orders/shipment-status'
import { Alert } from '~/components/ui/alert'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'

export const Route = createFileRoute('/_app/shop/checkout')({
  head: () => ({ meta: [{ title: 'Checkout · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/shop')}>
      <CheckoutPage />
    </RequireRole>
  ),
})

function CheckoutPage() {
  const cart = useCart()
  const catalog = useCatalog()
  const flights = useFlights()
  const settings = useOrderingSettings()
  const myService = useMyService()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [flight, setFlight] = React.useState('')
  const [otherDate, setOtherDate] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  if (catalog.isLoading || settings.isLoading) return <Spinner />
  const item = (id: string) => catalog.data?.find((c) => c.product_id === id)
  const currency = catalog.data?.[0]?.currency ?? 'USD'
  const feeText = serviceFeeText(myService.data)
  const total = cart.lines.reduce((s, l) => s + (item(l.product_id)?.price_per_stem ?? 0) * l.stems, 0)
  const earliest = settings.data?.earliest_ship_date

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!cart.lines.length) return setError('Your cart is empty.')
    const bad = cart.lines.find((l) => l.stems <= 0 || (l.bunching === 'custom' && !l.stems_per_bunch))
    if (bad) return setError(`${item(bad.product_id)?.variety ?? 'A line'}: give the stems${bad.bunching === 'custom' ? ' and stems per bunch' : ''}.`)
    if (!flight) return setError('Choose a flight, or "Another date".')
    if (flight === 'other' && !otherDate) return setError('Choose the date you would like it shipped.')
    setBusy(true)
    setError(null)
    try {
      const r = await placeOrder({ shipmentId: flight === 'other' ? null : flight, shipDate: flight === 'other' ? otherDate : null, lines: cart.lines, notes })
      cart.clear()
      void queryClient.invalidateQueries({ queryKey: ['my-orders'] })
      void navigate({ to: '/my-orders/$orderId', params: { orderId: r.order_id } })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Checkout" description="Check each line, choose how it's bunched, and pick your flight." />
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4">
        {error && <Alert variant="destructive" title={error} role="alert" />}
        <Card>
          <CardHeader>
            <CardTitle>Your cart</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {cart.lines.length === 0 ? (
              <p>
                Your cart is empty.{' '}
                <Link to="/shop" className="font-semibold underline underline-offset-2">
                  Go to the catalog
                </Link>
              </p>
            ) : (
              cart.lines.map((l) => (
                <CartLineEditor key={l.product_id} line={l} item={item(l.product_id)} onChange={(p) => cart.update(l.product_id, p)} onRemove={() => cart.remove(l.product_id)} />
              ))
            )}
            {cart.lines.length > 0 && (
              <p className="text-right text-lg">
                Estimated total: <strong>{money(total, currency)}</strong>
                {feeText && (
                  <span className="block text-sm text-muted-foreground">
                    Plus your {myService.data?.label} {feeText} (once per flight, however many orders).
                  </span>
                )}
                <span className="block text-sm text-muted-foreground">Other costs (UCR, data logger…) are added on the proforma invoice.</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Flight</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Orders need at least {settings.data?.min_lead_hours} hours before the flight. The earliest ship date now is{' '}
              <strong>{formatDate(earliest ?? null)}</strong>.
            </p>
            <div className="grid gap-1" role="radiogroup" aria-label="Flight">
              {(flights.data ?? []).map((f) => (
                <label key={f.shipment_id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3">
                  <input type="radio" name="flight" className="size-5 accent-accent" checked={flight === f.shipment_id} onChange={() => setFlight(f.shipment_id)} />
                  <span>
                    <strong>{formatDate(f.flight_date)}</strong> · {f.flight_no ?? 'Flight to be confirmed'} to {f.destination_airport}
                  </span>
                </label>
              ))}
              {flights.data?.length === 0 && <p className="text-sm">No flights are open for your airport yet. Choose another date below.</p>}
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3">
                <input type="radio" name="flight" className="size-5 accent-accent" checked={flight === 'other'} onChange={() => setFlight('other')} />
                Another date: ConsolFlora will find a flight
              </label>
            </div>
            {flight === 'other' && (
              <Field id="other-date" label="Ship date you would like" hint={`The earliest is ${formatDate(earliest ?? null)}.`}>
                {(d) => <Input id="other-date" type="date" min={earliest} value={otherDate} onChange={(e) => setOtherDate(e.target.value)} aria-describedby={d} className="sm:max-w-56" />}
              </Field>
            )}
            <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              For new buyers the flight is subject to change: ConsolFlora confirms it and may move the order to a better flight. You will be told before
              it ships.
            </p>
            <Field id="order-notes" label="Notes for ConsolFlora (optional)">
              {(d) => <Input id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} aria-describedby={d} />}
            </Field>
          </CardContent>
        </Card>
        <div className="flex flex-wrap justify-end gap-2">
          <Link to="/shop" className={buttonVariants({ variant: 'outline' })}>
            Keep shopping
          </Link>
          <Button type="submit" size="lg" disabled={busy || cart.lines.length === 0}>
            {busy ? 'Placing order…' : 'Place order'}
          </Button>
        </div>
      </form>
    </>
  )
}
