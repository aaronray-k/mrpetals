import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Pencil, Plus } from 'lucide-react'
import {
  WEEKDAYS,
  nextShipDates,
  saveStandingOrder,
  skipStandingWeek,
  useCatalog,
  useStandingOrders,
  type CartLine,
  type StandingOrder,
} from '~/lib/ordering/api'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { CartLineEditor } from '~/components/shop/cart-line-editor'
import { formatDate } from '~/components/orders/shipment-status'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/standing-orders')({
  head: () => ({ meta: [{ title: 'Standing orders · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/standing-orders')}>
      <StandingOrdersPage />
    </RequireRole>
  ),
})

function StandingOrdersPage() {
  const standing = useStandingOrders()
  const [editing, setEditing] = React.useState<StandingOrder | 'new' | null>(null)

  return (
    <>
      <PageHeader
        title="Standing orders"
        description="Orders that repeat on set days every week, until you change them."
        actions={
          !editing && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" /> New standing order
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="standing.how" title="How standing orders work">
          Each week's order is created 5 days before it ships and goes straight to the farms. Skip a single week, or change the standing order
          at any time; you get the proforma invoice and packing list after every change.
        </Tip>
        {editing && <StandingOrderEditor order={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
        {standing.isLoading && <Spinner />}
        {standing.error && <Alert variant="destructive" title="Couldn't load standing orders" role="alert">{(standing.error as Error).message}</Alert>}
        {standing.data?.length === 0 && !editing && <p className="text-muted-foreground">No standing orders yet.</p>}
        {standing.data?.map((so) => <StandingOrderCard key={so.id} order={so} onEdit={() => setEditing(so)} />)}
      </div>
    </>
  )
}

function StandingOrderCard({ order, onEdit }: { order: StandingOrder; onEdit: () => void }) {
  const catalog = useCatalog()
  const toast = useToast()
  const queryClient = useQueryClient()
  const skipped = new Set(order.standing_order_skips.map((s) => s.ship_date))
  // Ticks change at once; the server confirms (or the tick goes back with a message).
  const [pending, setPending] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => setPending({}), [order.standing_order_skips])
  const name = (id: string) => {
    const c = catalog.data?.find((x) => x.product_id === id)
    return c ? `${c.variety} ${c.stem_length_cm} cm` : 'Product'
  }
  const days = order.weekdays.map((d) => WEEKDAYS[d - 1]).join(' and ')

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-5" aria-hidden="true" /> Every {days}
            </CardTitle>
            <CardDescription>
              {order.standing_order_lines.length} {order.standing_order_lines.length === 1 ? 'line' : 'lines'} ·{' '}
              {order.standing_order_lines.reduce((s, l) => s + l.stems, 0).toLocaleString('en-GB')} stems per shipment
              {order.notes ? ` · ${order.notes}` : ''}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {order.active ? <Badge variant="success">Active</Badge> : <Badge>Paused</Badge>}
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil aria-hidden="true" /> Change
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="grid gap-1 text-sm">
          {order.standing_order_lines
            .sort((a, b) => a.line_no - b.line_no)
            .map((l) => (
              <li key={l.line_no}>
                {name(l.product_id)}: <strong>{l.stems.toLocaleString('en-GB')} stems</strong>
                {l.bunching === 'consolflora' ? ' · ConsolFlora decides bunching' : l.bunching === 'custom' ? ` · ${l.stems_per_bunch} per bunch` : ''}
              </li>
            ))}
        </ul>
        {order.active && (
          <div className="grid gap-2">
            <p className="text-sm font-semibold">Next shipments</p>
            <ul className="flex flex-wrap gap-2">
              {nextShipDates(order.weekdays).map((d) => (
                <li key={d}>
                  <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-6 shrink-0 accent-accent"
                      checked={pending[d] ?? !skipped.has(d)}
                      onChange={async (e) => {
                        const on = e.target.checked
                        setPending((p) => ({ ...p, [d]: on }))
                        try {
                          await skipStandingWeek(order.id, d, !on)
                          toast({ kind: 'success', title: on ? `${formatDate(d)} is back on` : `${formatDate(d)} skipped` })
                          void queryClient.invalidateQueries({ queryKey: ['standing-orders'] })
                        } catch (err) {
                          setPending((p) => ({ ...p, [d]: !on }))
                          toast({ kind: 'error', title: 'Not changed', description: (err as Error).message })
                        }
                      }}
                    />
                    {formatDate(d)}
                    {!(pending[d] ?? !skipped.has(d)) && <span className="text-muted-foreground">(skipped)</span>}
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">Untick a date to skip that week.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StandingOrderEditor({ order, onDone }: { order: StandingOrder | null; onDone: () => void }) {
  const catalog = useCatalog()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [weekdays, setWeekdays] = React.useState<number[]>(order?.weekdays ?? [1, 4])
  const [active, setActive] = React.useState(order?.active ?? true)
  const [notes, setNotes] = React.useState(order?.notes ?? '')
  const [lines, setLines] = React.useState<CartLine[]>(
    order?.standing_order_lines
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({ product_id: l.product_id, stems: l.stems, bunching: l.bunching, stems_per_bunch: l.stems_per_bunch, sleeves: l.sleeves, bunch_labels: l.bunch_labels, notes: l.notes ?? '' })) ?? [],
  )
  const [adding, setAdding] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const item = (id: string) => catalog.data?.find((c) => c.product_id === id)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!weekdays.length) return setError('Choose at least one ship day.')
    if (!lines.length) return setError('Add at least one product.')
    setBusy(true)
    setError(null)
    try {
      await saveStandingOrder({ id: order?.id ?? null, customerId: null, weekdays, lines, active, notes })
      toast({ kind: 'success', title: order ? 'Standing order changed' : 'Standing order set up', description: 'The proforma and packing list will follow by email.' })
      void queryClient.invalidateQueries({ queryKey: ['standing-orders'] })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{order ? 'Change standing order' : 'New standing order'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} noValidate className="grid gap-4">
          {error && <Alert variant="destructive" title={error} role="alert" />}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Ship days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3">
                  <input
                    type="checkbox"
                    className="size-6 shrink-0 accent-accent"
                    checked={weekdays.includes(i + 1)}
                    onChange={(e) => setWeekdays((w) => (e.target.checked ? [...w, i + 1].sort() : w.filter((x) => x !== i + 1)))}
                  />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
          {lines.map((l) => (
            <CartLineEditor
              key={l.product_id}
              line={l}
              item={item(l.product_id)}
              onChange={(p) => setLines((ls) => ls.map((x) => (x.product_id === l.product_id ? { ...x, ...p } : x)))}
              onRemove={() => setLines((ls) => ls.filter((x) => x.product_id !== l.product_id))}
            />
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <Field id="so-add" label="Add a product">
              {(d) => (
                <Select id="so-add" value={adding} onChange={(e) => setAdding(e.target.value)} aria-describedby={d} className="sm:min-w-80">
                  <option value="">Choose from the catalog…</option>
                  {catalog.data
                    ?.filter((c) => !lines.some((l) => l.product_id === c.product_id))
                    .map((c) => (
                      <option key={c.product_id} value={c.product_id}>
                        {c.variety} · {c.stem_length_cm} cm · {c.grade}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Button
              variant="outline"
              disabled={!adding}
              onClick={() => {
                const c = item(adding)
                if (!c) return
                setLines((ls) => [...ls, { product_id: c.product_id, stems: c.stems_per_bunch * 10, bunching: 'standard', stems_per_bunch: null, sleeves: null, bunch_labels: null, notes: '' }])
                setAdding('')
              }}
            >
              <Plus aria-hidden="true" /> Add
            </Button>
          </div>
          <Field id="so-notes" label="Notes (optional)">
            {(d) => <Input id="so-notes" value={notes} onChange={(e) => setNotes(e.target.value)} aria-describedby={d} />}
          </Field>
          <Switch checked={active} onCheckedChange={setActive} label="Standing order is active" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save standing order'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
