import * as React from 'react'
import { AlertTriangle, CheckCircle2, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import {
  allocateLine,
  productLabel,
  removeAllocation,
  setGrowerPrice,
  updateOrderLine,
  type FarmRef,
  type Order,
  type OrderLine,
  type PackRateRef,
  type PoLine,
  type ProductRef,
  type PurchaseOrder,
} from '~/lib/orders/api'
import { useFarmOptions } from '~/lib/ordering/api'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Field, Input, Label, Select } from '~/components/ui/input'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'
import { PoStatus } from './status'

export interface OrderRefs {
  farms: FarmRef[]
  products: ProductRef[]
  packRates: PackRateRef[]
}

const fmt = (n: number) => n.toLocaleString('en-GB')
export const boxesFor = (stems: number, perBox: number) => Math.ceil(stems / perBox)

/** One order line: how much is placed with farms, its margin, and the form to add a farm. */
export function OrderLineCard({
  order,
  line,
  pos,
  poLines,
  refs,
  canEdit,
  canSeeMoney,
  onChanged,
}: {
  order: Order
  line: OrderLine
  pos: PurchaseOrder[]
  poLines: PoLine[]
  refs: OrderRefs
  canEdit: boolean
  canSeeMoney: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const product = refs.products.find((p) => p.id === line.product_id)
  const allocations = poLines.filter((l) => l.order_line_id === line.id)
  const placed = allocations.reduce((s, l) => s + l.stems, 0)
  const left = line.stems - placed
  const po = (id: string) => pos.find((p) => p.id === id)
  const farmName = (id: string | undefined) => refs.farms.find((f) => f.id === id)?.farm_name ?? 'Farm'
  const boxCode = (id: string) => refs.packRates.find((r) => r.box_type_id === id)?.box_types?.box_code ?? 'Box'
  const headingId = `line-${line.id}`
  const [pricing, setPricing] = React.useState<PoLine | null>(null)

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id={headingId} className="font-bold">
            Line {line.line_no}: {product ? productLabel(product) : 'Product'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {product?.product_code}
            {line.notes && <> · {line.notes}</>}
          </p>
          <p className="text-sm">
            {line.bunching === 'consolflora'
              ? 'ConsolFlora decides bunching, sleeves and labels'
              : line.bunching === 'custom'
                ? `${line.stems_per_bunch} stems per bunch${line.sleeves ? ', sleeves' : ''}${line.bunch_labels ? ', bunch labels' : ''}`
                : `Standard bunching${product ? ` (${product.stems_per_bunch} per bunch)` : ''}`}
            {canSeeMoney && line.quoted_price_per_stem != null && <> · buyer pays {line.quoted_price_per_stem.toFixed(3)} per stem</>}
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums" role="status">
          {left === 0 ? (
            <>
              <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> All {fmt(line.stems)} stems placed
            </>
          ) : (
            <>
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" /> {fmt(placed)} of {fmt(line.stems)} stems placed ·{' '}
              {fmt(left)} left
            </>
          )}
        </p>
      </div>

      {canSeeMoney && <MarginField order={order} line={line} canEdit={canEdit} onChanged={onChanged} />}

      {allocations.length > 0 && (
        <div className="min-w-0 rounded-md border">
          <Table>
            <caption className="sr-only">Farms for line {line.line_no}</caption>
            <THead>
              <TR>
                <TH>Farm</TH>
                <TH>PO</TH>
                <TH className="text-right">Stems</TH>
                <TH>Box</TH>
                <TH className="text-right">Stems per box</TH>
                <TH className="text-right">Boxes</TH>
                {canSeeMoney && <TH className="text-right">Grower price</TH>}
                {canEdit && (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {allocations.map((a) => {
                const p = po(a.po_id)
                const editable = p && (p.status === 'draft' || p.status === 'declined')
                return (
                  <TR key={a.id}>
                    <TD className="font-semibold">{farmName(p?.farm_id)}</TD>
                    <TD className="whitespace-nowrap">
                      <span className="block font-mono text-sm">{p?.po_number}</span>
                      {p && <PoStatus status={p.status} />}
                    </TD>
                    <TD className="text-right tabular-nums">{fmt(a.stems)}</TD>
                    <TD>{boxCode(a.box_type_id)}</TD>
                    <TD className="text-right tabular-nums">{fmt(a.stems_per_box)}</TD>
                    <TD className="text-right tabular-nums">{boxesFor(a.stems, a.stems_per_box)}</TD>
                    {canSeeMoney && (
                      <TD className="text-right tabular-nums whitespace-nowrap">
                        {a.grower_price_per_stem == null ? (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <AlertTriangle className="size-4" aria-hidden="true" /> No price
                          </span>
                        ) : (
                          a.grower_price_per_stem.toFixed(3)
                        )}
                        {canEdit && (
                          <Button variant="ghost" size="sm" className="ml-1" onClick={() => setPricing(a)}>
                            <Pencil aria-hidden="true" />
                            {a.grower_price_per_stem == null ? 'Set' : <span className="sr-only">Change</span>}
                            <span className="sr-only"> grower price for {farmName(p?.farm_id)}</span>
                          </Button>
                        )}
                      </TD>
                    )}
                    {canEdit && (
                      <TD className="text-right">
                        {editable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              try {
                                await removeAllocation(a.id)
                                toast({ kind: 'success', title: `${farmName(p?.farm_id)} removed from line ${line.line_no}` })
                                onChanged()
                              } catch (e) {
                                toast({ kind: 'error', title: 'Not removed', description: (e as Error).message })
                              }
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                            <span className="sr-only">
                              Remove {farmName(p?.farm_id)} from line {line.line_no}
                            </span>
                          </Button>
                        )}
                      </TD>
                    )}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </div>
      )}

      {canEdit && order.status === 'open' && left > 0 && product && (
        <AddFarmForm
          line={line}
          left={left}
          product={product}
          refs={refs}
          takenFarmIds={allocations.map((a) => po(a.po_id)?.farm_id).filter((x): x is string => !!x)}
          lockedFarmIds={pos.filter((p) => p.status === 'sent' || p.status === 'confirmed').map((p) => p.farm_id)}
          onAdded={onChanged}
        />
      )}
      {pricing && (
        <GrowerPriceDialog
          allocation={pricing}
          farm={farmName(po(pricing.po_id)?.farm_id)}
          onClose={() => setPricing(null)}
          onSaved={() => {
            setPricing(null)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

function MarginField({ order, line, canEdit, onChanged }: { order: Order; line: OrderLine; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast()
  const id = `margin-${line.id}`
  const [value, setValue] = React.useState(line.margin_per_stem == null ? '' : String(line.margin_per_stem))
  React.useEffect(() => setValue(line.margin_per_stem == null ? '' : String(line.margin_per_stem)), [line.margin_per_stem])
  const missing = line.margin_per_stem == null

  async function save() {
    const text = value.trim()
    const next = text === '' ? null : Number(text)
    if (next === line.margin_per_stem) return
    if (next != null && (!Number.isFinite(next) || next < 0)) {
      toast({ kind: 'error', title: 'Margin not saved', description: 'Enter a number of 0 or more, like 0.015.' })
      return
    }
    try {
      await updateOrderLine(line.id, { margin_per_stem: next })
      toast({ kind: 'success', title: `Margin for line ${line.line_no} saved` })
      onChanged()
    } catch (e) {
      toast({ kind: 'error', title: 'Margin not saved', description: (e as Error).message })
    }
  }

  if (!canEdit)
    return (
      <p className="text-sm">
        <span className="font-semibold">Margin per stem ({order.incoterm}):</span>{' '}
        {missing ? <span className="text-warning">not set</span> : `${line.margin_per_stem} ${order.currency}`}
      </p>
    )
  return (
    <div className="grid gap-1.5 sm:max-w-md">
      <Label htmlFor={id}>
        Margin per stem ({order.incoterm}, {order.currency})
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        className="sm:max-w-40"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        aria-describedby={`${id}-hint`}
        aria-invalid={missing || undefined}
      />
      <p id={`${id}-hint`} className={missing ? 'flex items-center gap-1 text-sm font-semibold text-warning' : 'text-sm text-muted-foreground'}>
        {missing ? (
          <>
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> No {order.incoterm} margin rule fits this product. Enter the margin
            here, or add a rule on the Margins page.
          </>
        ) : (
          'Filled in from the margin rules. Change it for this order only. Saved when you leave the field.'
        )}
      </p>
    </div>
  )
}

function AddFarmForm({
  line,
  left,
  product,
  refs,
  takenFarmIds,
  lockedFarmIds,
  onAdded,
}: {
  line: OrderLine
  left: number
  product: ProductRef
  refs: OrderRefs
  takenFarmIds: string[]
  lockedFarmIds: string[]
  onAdded: () => void
}) {
  const toast = useToast()
  const rates = refs.packRates.filter((r) => r.product_id === product.id)
  const farms = refs.farms.filter((f) => !takenFarmIds.includes(f.id) && !lockedFarmIds.includes(f.id))
  const options = useFarmOptions(line.id)
  const recommended = options.data?.find((o) => o.recommended && farms.some((f) => f.id === o.farm_id)) ?? options.data?.find((o) => farms.some((f) => f.id === o.farm_id))
  const [farmId, setFarmId] = React.useState('')
  // Start on the recommended farm (pinned by Admin, else the cheapest still free), or the product's usual farm.
  React.useEffect(() => {
    if (farmId || !options.data) return
    setFarmId(recommended?.farm_id ?? farms.find((f) => f.id === product.default_farm_id)?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data, recommended?.farm_id])
  const [stems, setStems] = React.useState(String(left))
  const [boxTypeId, setBoxTypeId] = React.useState(rates[0]?.box_type_id ?? '')
  const rate = rates.find((r) => r.box_type_id === boxTypeId)
  const packDefault = rate ? rate.bunches_per_box * product.stems_per_bunch : null
  const [perBox, setPerBox] = React.useState(packDefault == null ? '' : String(packDefault))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => setStems(String(left)), [left])
  const p = `add-${line.id}`

  const stemsN = Number(stems)
  const perBoxN = Number(perBox)
  const preview = Number.isInteger(stemsN) && stemsN > 0 && Number.isInteger(perBoxN) && perBoxN > 0 ? boxesFor(stemsN, perBoxN) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!farmId) return setError('Choose the farm.')
    if (!/^\d+$/.test(stems.trim()) || stemsN <= 0) return setError('Enter a whole number of stems.')
    if (stemsN > left) return setError(`Only ${fmt(left)} stems are left on this line.`)
    if (!rates.length) return setError(`Product ${product.product_code} has no pack rate. Add one on the import page first.`)
    if (!/^\d+$/.test(perBox.trim()) || perBoxN <= 0) return setError('Enter a whole number of stems per box.')
    setBusy(true)
    setError(null)
    try {
      await allocateLine({ orderLineId: line.id, farmId, stems: stemsN, boxTypeId: boxTypeId || null, stemsPerBox: perBoxN })
      toast({ kind: 'success', title: `${fmt(stemsN)} stems added for ${refs.farms.find((f) => f.id === farmId)?.farm_name}` })
      setFarmId('')
      onAdded()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!farms.length)
    return <p className="text-sm text-muted-foreground">Every active farm is already on this line or has a PO that was sent. Remove a farm to change it.</p>

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 rounded-md bg-muted/60 p-3" aria-label={`Add a farm to line ${line.line_no}`}>
      <p className="font-semibold">Add a farm</p>
      {options.data && options.data.length > 0 && (
        <div className="min-w-0 rounded-md border bg-card">
          <Table>
            <caption className="px-3 py-2 text-left text-sm font-semibold">Cost calculator: farms with a price for this product</caption>
            <THead>
              <TR>
                <TH>Farm</TH>
                <TH className="text-right">Farm price</TH>
                <TH className="text-right">Buyer pays</TH>
                <TH className="text-right">Margin</TH>
                <TH className="text-right">Cost for {fmt(left)} stems</TH>
                <TH>
                  <span className="sr-only">Choose</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {options.data.map((o) => {
                const free = farms.some((f) => f.id === o.farm_id)
                return (
                  <TR key={o.farm_id} className={o.farm_id === farmId ? 'bg-accent/10' : undefined}>
                    <TD>
                      <span className="font-semibold">{o.farm_name}</span>
                      {o.recommended && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-success-bg px-1.5 text-xs font-bold text-success">
                          <Star className="size-3" aria-hidden="true" /> {o.pinned ? 'Pinned by Admin' : 'Cheapest'}
                        </span>
                      )}
                      {o.placed_stems > 0 && <span className="block text-xs text-muted-foreground">{fmt(o.placed_stems)} stems already placed</span>}
                    </TD>
                    <TD className="text-right tabular-nums">{o.cost_per_stem.toFixed(3)}</TD>
                    <TD className="text-right tabular-nums">{o.sell_per_stem.toFixed(3)}</TD>
                    <TD className={`text-right tabular-nums ${o.margin_per_stem < 0 ? 'font-semibold text-destructive' : ''}`}>
                      {o.margin_per_stem < 0 && <span className="sr-only">Loss: </span>}
                      {o.margin_per_stem.toFixed(3)}
                    </TD>
                    <TD className="text-right tabular-nums">{(o.cost_per_stem * left).toFixed(2)}</TD>
                    <TD>
                      {free ? (
                        <Button size="sm" variant={o.farm_id === farmId ? 'default' : 'outline'} onClick={() => setFarmId(o.farm_id)}>
                          {o.farm_id === farmId ? 'Chosen' : 'Choose'}
                          <span className="sr-only"> {o.farm_name}</span>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">PO sent</span>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </div>
      )}
      {options.data?.length === 0 && <p className="text-sm text-warning">No farm has a price for this product yet. You can still choose a farm; set its price afterwards.</p>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem_8rem] sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor={`${p}-farm`}>Farm</Label>
          <Select id={`${p}-farm`} value={farmId} onChange={(e) => setFarmId(e.target.value)}>
            <option value="">Choose a farm…</option>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.farm_name} ({f.farm_code}){f.id === product.default_farm_id ? ' · usual farm' : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${p}-stems`}>Stems</Label>
          <Input id={`${p}-stems`} inputMode="numeric" value={stems} onChange={(e) => setStems(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${p}-box`}>Box type</Label>
          <Select
            id={`${p}-box`}
            value={boxTypeId}
            disabled={rates.length < 2}
            onChange={(e) => {
              setBoxTypeId(e.target.value)
              const r = rates.find((x) => x.box_type_id === e.target.value)
              if (r) setPerBox(String(r.bunches_per_box * product.stems_per_bunch))
            }}
          >
            {!rates.length && <option value="">No pack rate</option>}
            {rates.map((r) => (
              <option key={r.box_type_id} value={r.box_type_id}>
                {r.box_types?.box_code ?? 'Box'} · {r.bunches_per_box} bunches
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${p}-perbox`}>Stems per box</Label>
          <Input id={`${p}-perbox`} inputMode="numeric" value={perBox} onChange={(e) => setPerBox(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          <Plus aria-hidden="true" /> {busy ? 'Adding…' : 'Add farm'}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {preview != null && `${preview} ${preview === 1 ? 'box' : 'boxes'}${packDefault != null && perBoxN !== packDefault ? ` (pack rate says ${packDefault} per box)` : ''}`}
        </span>
      </div>
      {error && (
        <p className="text-sm font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function GrowerPriceDialog({
  allocation,
  farm,
  onClose,
  onSaved,
}: {
  allocation: PoLine
  farm: string
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [value, setValue] = React.useState(allocation.grower_price_per_stem == null ? '' : String(allocation.grower_price_per_stem))
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(value.trim())
    if (!value.trim() || !Number.isFinite(n) || n < 0) return setError('Enter the price per stem, like 0.32.')
    setBusy(true)
    try {
      await setGrowerPrice(allocation.id, n)
      toast({ kind: 'success', title: `Grower price for ${farm} saved` })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Grower price: ${farm}`} description="What ConsolFlora pays the farm per stem on this PO line. The price list is not changed.">
      <form onSubmit={submit} noValidate className="grid gap-4">
        <Field id="grower-price" label="Price per stem" error={error}>
          {(d) => <Input id="grower-price" inputMode="decimal" value={value} autoFocus onChange={(e) => setValue(e.target.value)} aria-describedby={d} aria-invalid={!!error || undefined} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save price'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
