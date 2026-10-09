import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { getSupabase } from '~/lib/supabase'
import { DEFAULT_ALLOWANCES, ULDS, boxSizes, type Allowances, type Uld } from '~/lib/freight/packing'
import { toBoxLine, type BoxSpec } from '~/lib/freight/calibrate'
import { LoadChecks } from '~/components/freight/load-checks'
import { AssumptionsPanel } from '~/components/freight/assumptions-panel'
import { planShipment, suggestBestFit, type BoxLine, type ShipmentPlan, type Suggestion } from '~/lib/freight/mixed'
import { BOX_COLOURS, UldView } from '~/components/freight/uld-view'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Table, TBody, TD, TH, THead, TR } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

interface Airline {
  code: string
  name: string
  ulds: string[]
  via: string | null
  notes: string | null
}
interface Rate {
  airline_or_agent: string
  destination_airport: string
  currency: string
  rate_per_kg: number
  valid_from: string
}
/** A box line as typed: sizes in cm. */
interface Row {
  key: string
  label: string
  l: string
  w: string
  h: string
  kg: string
  count: string
  /** Inside or outside sizes, board thickness and bulge (mm per face), as typed. */
  basis: 'outside' | 'inside'
  wall: string
  bulgeTop: string
  bulgeSide: string
  bulgeEnd: string
}
/** A number that may be 0 (thickness, bulge). */
const num0 = (s: string) => {
  const v = Number(String(s).replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v : 0
}
const allowancesOf = (r: Row): Allowances => ({ sizes: r.basis, wallMm: num0(r.wall), bulgeTopMm: num0(r.bulgeTop), bulgeSideMm: num0(r.bulgeSide), bulgeEndMm: num0(r.bulgeEnd) })
type BoxTypeAllowances = { size_basis?: string; wall_mm?: number | null; bulge_top_mm?: number | null; bulge_side_mm?: number | null; bulge_end_mm?: number | null }
/** Row fields from a box type's allowances (or the starting figures). */
const rowAllowances = (b: BoxTypeAllowances = {}) => ({
  basis: (b.size_basis === 'inside' ? 'inside' : 'outside') as Row['basis'],
  wall: String(b.wall_mm ?? DEFAULT_ALLOWANCES.wallMm),
  bulgeTop: String(b.bulge_top_mm ?? DEFAULT_ALLOWANCES.bulgeTopMm),
  bulgeSide: String(b.bulge_side_mm ?? DEFAULT_ALLOWANCES.bulgeSideMm),
  bulgeEnd: String(b.bulge_end_mm ?? DEFAULT_ALLOWANCES.bulgeEndMm),
})
const num = (s: string) => {
  const v = Number(String(s).replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? v : null
}
const kg = (n: number) => `${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })} kg`
const pct = (n: number) => `${(n * 100).toFixed(0)}%`
const chargeable = (p: ShipmentPlan) => Math.max(p.grossKg, p.volumetricKg)
const uldsOf = (codes: string[]) => ULDS.filter((u) => codes.includes(u.code))
let seq = 0
const newRow = (r: Partial<Row> = {}): Row => ({ key: `r${++seq}`, label: 'Box', l: '', w: '', h: '', kg: '', count: '1', ...rowAllowances(), ...r })

export function MixedPlanner() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const lookups = useQuery({
    queryKey: ['load-planner-lookups'],
    queryFn: async () => {
      const sb = getSupabase()
      const [a, r, s, bt] = await Promise.all([
        sb.from('airlines').select('code, name, ulds, via, notes').eq('active', true).order('code'),
        sb.from('freight_rates').select('airline_or_agent, destination_airport, currency, rate_per_kg, valid_from').eq('origin_airport', 'NBO').order('valid_from', { ascending: false }),
        sb.from('shipments').select('id, shipment_ref, flight_no, flight_date, destination_airport, status').order('flight_date', { ascending: false, nullsFirst: false }).limit(40),
        sb.from('box_types').select('box_code, length_cm, width_cm, height_cm, tare_weight_kg, size_basis, wall_mm, bulge_top_mm, bulge_side_mm, bulge_end_mm').eq('active', true).order('box_code'),
      ])
      for (const x of [a, r, s, bt]) if (x.error) throw new Error(x.error.message)
      return {
        airlines: (a.data ?? []) as Airline[],
        rates: ((r.data ?? []) as Rate[]).map((x) => ({ ...x, rate_per_kg: Number(x.rate_per_kg) })),
        shipments: (s.data ?? []) as { id: string; shipment_ref: string; flight_no: string | null; flight_date: string | null; destination_airport: string | null; status: string }[],
        boxTypes: (bt.data ?? []) as ({ box_code: string; length_cm: number; width_cm: number; height_cm: number; tare_weight_kg: number | null } & BoxTypeAllowances)[],
      }
    },
  })
  const [rows, setRows] = React.useState<Row[]>([newRow({ label: 'Half box', l: '100', w: '50', h: '30', kg: '14', count: '18' }), newRow({ label: 'Quarter box', l: '100', w: '25', h: '15', kg: '7', count: '40' })])
  const [airline, setAirline] = React.useState('EK')
  const [dest, setDest] = React.useState('NRT')
  const [uldChoice, setUldChoice] = React.useState('best')
  const [clearance, setClearance] = React.useState('2')
  const [onSide, setOnSide] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<{ suggestion: Suggestion | null; plan: ShipmentPlan; byAirline: { a: Airline; plan: ShipmentPlan }[]; lines: BoxLine[]; specs: BoxSpec[]; shipmentId: string | null; allowOnSide: boolean } | null>(null)
  const [shipmentId, setShipmentId] = React.useState<string | null>(null)
  const [shown, setShown] = React.useState(0)
  const [upTo, setUpTo] = React.useState(99)

  const al = lookups.data?.airlines.find((a) => a.code === airline)
  const rateFor = (code: string) => lookups.data?.rates.find((r) => r.airline_or_agent === code && r.destination_airport === dest) ?? null
  // Each line as typed (nominal size, allowances), then the space each box really takes for the packer.
  const specs: BoxSpec[] = rows
    .map((r) => ({ key: r.key, label: r.label || 'Box', length: (num(r.l) ?? 0) * 10, width: (num(r.w) ?? 0) * 10, height: (num(r.h) ?? 0) * 10, allowances: allowancesOf(r), weightKg: num(r.kg), count: Math.floor(num(r.count) ?? 0) }))
    .filter((l) => l.length && l.width && l.height && l.count)
  const lines: BoxLine[] = specs.map(toBoxLine)
  const clear = (num(clearance) ?? 0) * 10

  const run = (suggest: boolean) => {
    if (!lines.length) return toast({ kind: 'error', title: 'Add at least one box line with its size and count' })
    setBusy(true)
    // Let the spinner paint before the work.
    setTimeout(() => {
      try {
        const own = al ? uldsOf(al.ulds) : ULDS
        let suggestion: Suggestion | null = null
        let plan: ShipmentPlan
        if (suggest || uldChoice === 'best') {
          suggestion = suggestBestFit(uldChoice === 'best' || suggest ? own : own.filter((u) => u.code === uldChoice), lines, clear, onSide)
          plan = suggestion.best
        } else {
          plan = planShipment(ULDS.find((u) => u.code === uldChoice)!, lines, { clearance: clear, allowOnSide: onSide, order: 'height' })
        }
        // Every airline's best plan, to compare containers and cost.
        const byAirline = (lookups.data?.airlines ?? []).map((a) => ({ a, plan: a.code === airline && suggestion ? plan : suggestBestFit(uldsOf(a.ulds), lines, clear, onSide).best }))
        setResult({ suggestion, plan, byAirline, lines, specs, shipmentId, allowOnSide: onSide })
        setShown(0)
        setUpTo(99)
      } finally {
        setBusy(false)
      }
    }, 30)
  }

  const plan = result?.plan
  // The box lines the plan was made from (the list above may have changed since).
  const planned = result?.lines ?? []
  const load = plan?.loads[shown]
  const levels = load ? new Set(load.boxes.map((b) => b.z)).size : 0

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[26rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Boxes to load</CardTitle>
          <CardDescription>Pull a shipment&apos;s boxes, or type the sizes and counts. Sizes in cm.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field id="mp-shipment" label="Load from a shipment">
            {(d) => (
              <Select
                id="mp-shipment"
                value=""
                aria-describedby={d}
                onChange={async (e) => {
                  const s = lookups.data?.shipments.find((x) => x.id === e.target.value)
                  if (!s) return
                  const { data, error } = await getSupabase().rpc('shipment_load_lines', { p_shipment_id: s.id })
                  if (error) return toast({ kind: 'error', title: 'Couldn\'t read the shipment', description: error.message })
                  const got = (data ?? []) as ({ box_code: string; description: string | null; length_cm: number; width_cm: number; height_cm: number; boxes: number; est_weight_kg: number | null } & BoxTypeAllowances)[]
                  if (!got.length) return toast({ kind: 'error', title: `${s.shipment_ref} has no boxes yet` })
                  setRows(got.map((g) => newRow({ label: g.box_code, l: String(g.length_cm), w: String(g.width_cm), h: String(g.height_cm), kg: g.est_weight_kg != null ? String(g.est_weight_kg) : '', count: String(g.boxes), ...rowAllowances(g) })))
                  setShipmentId(s.id)
                  if (s.destination_airport) setDest(s.destination_airport)
                  setResult(null)
                  toast({ kind: 'success', title: `${s.shipment_ref}: ${got.reduce((n, g) => n + g.boxes, 0)} boxes in ${got.length} sizes` })
                }}
              >
                <option value="">Choose a shipment…</option>
                {(lookups.data?.shipments ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shipment_ref}
                    {s.flight_no ? ` · ${s.flight_no}` : ''}
                    {s.flight_date ? ` · ${s.flight_date}` : ''}
                    {s.destination_airport ? ` → ${s.destination_airport}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <ul className="grid gap-3">
            {rows.map((r, i) => (
              <li key={r.key} className="grid gap-2 rounded-md border p-2" style={{ borderLeft: `6px solid ${BOX_COLOURS[i % BOX_COLOURS.length]}` }}>
                <div className="flex items-end gap-2">
                  <Field id={`${r.key}-label`} label="Box">
                    {(d) => <Input id={`${r.key}-label`} value={r.label} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, label: e.target.value } : x)))} aria-describedby={d} />}
                  </Field>
                  <Button variant="outline" size="icon" aria-label={`Remove ${r.label}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {(
                    [
                      ['l', 'L'],
                      ['w', 'W'],
                      ['h', 'H'],
                      ['kg', 'kg'],
                      ['count', 'Boxes'],
                    ] as const
                  ).map(([k, label]) => (
                    <Field key={k} id={`${r.key}-${k}`} label={label}>
                      {(d) => (
                        <Input id={`${r.key}-${k}`} inputMode="decimal" value={r[k]} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, [k]: e.target.value } : x)))} aria-describedby={d} className="px-2" />
                      )}
                    </Field>
                  ))}
                </div>
                <AllowanceFields r={r} set={(patch) => setRows(rows.map((x) => (x.key === r.key ? { ...x, ...patch } : x)))} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setRows([...rows, newRow()])}>
              <Plus aria-hidden="true" /> Add a box size
            </Button>
            <Select
              aria-label="Add a box type"
              value=""
              className="w-auto"
              onChange={(e) => {
                const b = lookups.data?.boxTypes.find((x) => x.box_code === e.target.value)
                if (b) setRows([...rows, newRow({ label: b.box_code, l: String(b.length_cm), w: String(b.width_cm), h: String(b.height_cm), kg: '', count: '10', ...rowAllowances(b) })])
              }}
            >
              <option value="">Add a box type…</option>
              {(lookups.data?.boxTypes ?? []).map((b) => (
                <option key={b.box_code} value={b.box_code}>
                  {b.box_code} ({b.length_cm}×{b.width_cm}×{b.height_cm})
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field id="mp-airline" label="Airline" hint={al ? `Via ${al.via ?? '–'}. ${al.notes ?? ''}` : undefined}>
              {(d) => (
                <Select id="mp-airline" value={airline} onChange={(e) => setAirline(e.target.value)} aria-describedby={d}>
                  {(lookups.data?.airlines ?? []).map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="mp-dest" label="To (airport)">
              {(d) => <Input id="mp-dest" value={dest} maxLength={3} onChange={(e) => setDest(e.target.value.toUpperCase())} aria-describedby={d} className="uppercase" />}
            </Field>
          </div>
          <RateEditor airline={airline} dest={dest} rate={rateFor(airline)} onSaved={() => void queryClient.invalidateQueries({ queryKey: ['load-planner-lookups'] })} />
          <Field id="mp-uld" label="Container">
            {(d) => (
              <Select id="mp-uld" value={uldChoice} onChange={(e) => setUldChoice(e.target.value)} aria-describedby={d}>
                <option value="best">Best for this airline</option>
                {(al ? uldsOf(al.ulds) : ULDS).map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="mp-clear" label="Space kept free on each side (cm)">
            {(d) => <Input id="mp-clear" inputMode="decimal" value={clearance} onChange={(e) => setClearance(e.target.value)} aria-describedby={d} />}
          </Field>
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-5 accent-accent" checked={onSide} onChange={(e) => setOnSide(e.target.checked)} />
            Boxes may be laid on their side
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(true)} disabled={busy}>
              <Sparkles aria-hidden="true" /> Suggest best fit
            </Button>
            <Button variant="outline" onClick={() => run(false)} disabled={busy}>
              Plan with these settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 content-start gap-4">
        {busy && <Spinner />}
        {!result && !busy && (
          <Alert title="Press Suggest best fit">
            It tries every container {al ? `${al.code} flies` : ''}, flat and on the side, in several loading orders, and picks the plan that needs the fewest
            containers, then the fullest. Every airline is compared below it.
          </Alert>
        )}
        {result && plan && (
          <>
            <SuggestionText result={result} lines={planned} />
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Containers" value={`${plan.loads.length} × ${plan.uld.code}`} />
              <Stat label="Boxes loaded" value={`${plan.totalBoxes}`} sub={plan.onSide ? `${plan.onSide} on their side` : 'all flat'} />
              <Stat label="Space used (average)" value={pct(plan.fill)} />
              <Stat label="Chargeable weight" value={kg(chargeable(plan))} sub={`${planned.some((l) => l.weightKg) ? `actual ${kg(plan.grossKg)}` : 'no box weights'} · volumetric ${kg(plan.volumetricKg)}`} />
            </dl>
            {plan.unplaced.some((n) => n > 0) && (
              <Alert variant="warning" title="Some boxes don't fit this container at all">
                {plan.unplaced.map((n, i) => (n ? `${n} × ${planned[i]!.label}` : '')).filter(Boolean).join(', ')}: bigger than the container. Try a PMC or lay them on their side.
              </Alert>
            )}
            {load && (
              <Card>
                <CardContent className="grid gap-3 pt-6">
                  {plan.loads.length > 1 && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Container">
                      {plan.loads.map((l, i) => (
                        <Button key={i} variant={i === shown ? 'default' : 'outline'} size="sm" onClick={() => { setShown(i); setUpTo(99) }} aria-pressed={i === shown}>
                          {plan.uld.code} {i + 1}: {l.boxes.length} boxes, {pct(l.fill)}
                        </Button>
                      ))}
                    </div>
                  )}
                  <UldView uld={plan.uld} plan={load} upTo={upTo} className="h-[26rem] w-full touch-none rounded-md border bg-muted/30" />
                  {levels > 1 && (
                    <Field id="mp-layers" label={`Show boxes standing at the lowest ${Math.min(upTo, levels)} of ${levels} heights`}>
                      {(d) => <input id="mp-layers" type="range" min={1} max={levels} value={Math.min(upTo, levels)} onChange={(e) => setUpTo(Number(e.target.value))} aria-describedby={d} className="w-full accent-accent" />}
                    </Field>
                  )}
                  <ContainerTable plan={plan} index={shown} lines={planned} />
                </CardContent>
              </Card>
            )}
            <AirlineTable result={result} dest={dest} rateFor={rateFor} current={airline} />
            <AssumptionsPanel uld={plan.uld} specs={result.specs} options={{ ...plan.options, allowOnSide: result.allowOnSide }} rate={rateFor(airline)?.rate_per_kg ?? null} currency={rateFor(airline)?.currency ?? 'USD'} />
            <LoadChecks plan={plan} specs={result.specs} airline={airline} shipmentId={result.shipmentId} />
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
      {sub && <dd className="text-sm text-muted-foreground">{sub}</dd>}
    </div>
  )
}

function SuggestionText({ result, lines }: { result: { suggestion: Suggestion | null; plan: ShipmentPlan }; lines: BoxLine[] }) {
  const s = result.suggestion
  if (!s) return null
  const best = s.best
  const flat = s.flatSameUld
  const boxes = best.loads.flatMap((l) => l.boxes)
  const sideLines = [...new Set(boxes.filter((b) => Math.abs(b.dz - lines[b.line]!.height) > 0.5).map((b) => lines[b.line]!.label))]
  const fewer = flat && flat !== best ? flat.loads.length - best.loads.length : 0
  const extra = flat && flat !== best && fewer === 0 ? (best.loads.at(-1)?.fill ?? 0) - (flat.loads.at(-1)?.fill ?? 0) : 0
  return (
    <Alert variant="success" title={`Best fit: ${best.loads.length} × ${best.uld.name}`}>
      {best.onSide > 0 ? (
        <>
          Lay {best.onSide} boxes on their side ({sideLines.join(', ')}).{' '}
          {!flat
            ? 'Kept flat, they would not fit this container.'
            : fewer > 0
              ? `Kept flat they need ${flat.loads.length} ${best.uld.code}s: on their side saves ${fewer}.`
              : `Kept flat they also fit ${flat.loads.length} ${best.uld.code}${flat.loads.length === 1 ? '' : 's'}, but on their side the boxes sit tighter (the last ${best.uld.code} is ${pct(Math.abs(extra))} ${extra < 0 ? 'emptier' : 'fuller'}).`}
        </>
      ) : (
        'Every box stays flat; laying boxes on their side gains nothing here.'
      )}{' '}
      Space used: {pct(best.fill)} on average; the last {best.uld.code} is {pct(best.loads.at(-1)?.fill ?? 0)} full.
    </Alert>
  )
}

function ContainerTable({ plan, index, lines }: { plan: ShipmentPlan; index: number; lines: BoxLine[] }) {
  const load = plan.loads[index]!
  return (
    <Table>
      <caption className="text-left text-sm text-muted-foreground">
        {plan.uld.code} {index + 1}: {load.boxes.length} boxes, {kg(load.grossKg)} actual, {kg(load.volumetricKg)} volumetric, {pct(load.fill)} of the space.
      </caption>
      <THead>
        <TR>
          <TH>Box</TH>
          <TH>Size (cm)</TH>
          <TH className="text-right">In this container</TH>
          <TH className="text-right">On their side</TH>
        </TR>
      </THead>
      <TBody>
        {lines.map((l, i) => {
          const mine = load.boxes.filter((b) => b.line === i)
          if (!mine.length) return null
          return (
            <TR key={l.key}>
              <TD>
                <span className="inline-flex items-center gap-2 font-semibold">
                  <span className="size-3 rounded-sm" style={{ background: BOX_COLOURS[i % BOX_COLOURS.length] }} aria-hidden="true" /> {l.label}
                </span>
              </TD>
              <TD className="tabular-nums">
                {l.length / 10} × {l.width / 10} × {l.height / 10}
              </TD>
              <TD className="text-right tabular-nums">{mine.length}</TD>
              <TD className="text-right tabular-nums">{mine.filter((b) => Math.abs(b.dz - l.height) > 0.5).length}</TD>
            </TR>
          )
        })}
      </TBody>
    </Table>
  )
}

function AirlineTable({ result, dest, rateFor, current }: { result: { byAirline: { a: Airline; plan: ShipmentPlan }[] }; dest: string; rateFor: (code: string) => Rate | null; current: string }) {
  const rows = result.byAirline
    .map(({ a, plan }) => {
      const r = rateFor(a.code)
      return { a, plan, r, cost: r ? chargeable(plan) * r.rate_per_kg : null }
    })
    .sort((x, y) => (x.cost ?? Infinity) - (y.cost ?? Infinity) || x.plan.loads.length - y.plan.loads.length)
  const cheapest = rows.find((r) => r.cost != null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Airlines compared, NBO → {dest}</CardTitle>
        <CardDescription>Each airline&apos;s best fit in the containers it flies, and the freight at its rate (chargeable weight × rate per kg). Enter rates from your freight agent&apos;s quotes.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <caption className="sr-only">Airlines compared</caption>
          <THead>
            <TR>
              <TH>Airline</TH>
              <TH>Best fit</TH>
              <TH className="text-right">Space used</TH>
              <TH className="text-right">Chargeable</TH>
              <TH className="text-right">Rate per kg</TH>
              <TH className="text-right">Freight</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map(({ a, plan, r, cost }) => (
              <TR key={a.code} className={a.code === current ? 'bg-muted/50' : undefined}>
                <TD className="font-semibold">
                  {a.code} <span className="font-normal text-muted-foreground">{a.name}</span> {cheapest && cheapest.a === a && <Badge variant="success">Lowest freight</Badge>}
                </TD>
                <TD>
                  {plan.loads.length} × {plan.uld.code}
                  {plan.onSide ? ` (${plan.onSide} on side)` : ''}
                </TD>
                <TD className="text-right tabular-nums">{pct(plan.fill)}</TD>
                <TD className="text-right tabular-nums">{kg(chargeable(plan))}</TD>
                <TD className="text-right tabular-nums">{r ? `${r.currency} ${r.rate_per_kg.toFixed(2)}` : 'no rate yet'}</TD>
                <TD className="text-right tabular-nums">{cost != null ? `${r!.currency} ${cost.toLocaleString('en-GB', { maximumFractionDigits: 0 })}` : '–'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/** The airline's rate per kg to the destination, from the freight agent: shown, and changed from today. */
function RateEditor({ airline, dest, rate, onSaved }: { airline: string; dest: string; rate: Rate | null; onSaved: () => void }) {
  const toast = useToast()
  const [v, setV] = React.useState('')
  const [cur, setCur] = React.useState('USD')
  React.useEffect(() => {
    setV(rate ? String(rate.rate_per_kg) : '')
    setCur(rate?.currency ?? 'USD')
  }, [rate, airline, dest])
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        const n = num(v)
        if (!n || !/^[A-Z]{3}$/.test(dest)) return toast({ kind: 'error', title: 'Enter the rate per kg and a 3-letter airport' })
        const today = new Date().toISOString().slice(0, 10)
        const { error } = await getSupabase()
          .from('freight_rates')
          .upsert({ origin_airport: 'NBO', destination_airport: dest, airline_or_agent: airline, currency: cur, rate_per_kg: n, valid_from: today }, { onConflict: 'origin_airport,destination_airport,airline_or_agent,valid_from' })
        if (error) return toast({ kind: 'error', title: 'Rate not saved', description: error.message })
        toast({ kind: 'success', title: `${airline} NBO → ${dest}: ${cur} ${n.toFixed(2)} per kg` })
        onSaved()
      }}
    >
      <Field id="mp-rate" label={`${airline} rate per kg to ${dest || '…'}`} hint={rate ? `Since ${rate.valid_from}` : 'No rate yet'}>
        {(d) => <Input id="mp-rate" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-describedby={d} className="w-28" />}
      </Field>
      <Field id="mp-rate-cur" label="Currency">
        {(d) => (
          <Select id="mp-rate-cur" value={cur} onChange={(e) => setCur(e.target.value)} aria-describedby={d}>
            {['USD', 'EUR', 'KES'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" variant="outline">
        Save rate
      </Button>
    </form>
  )
}

export type { Uld }

/** Board thickness and bulge for one box line; the summary shows the space a box really takes. */
function AllowanceFields({ r, set }: { r: Row; set: (patch: Partial<Row>) => void }) {
  const l = num(r.l), w = num(r.w), h = num(r.h)
  const sizes = l && w && h ? boxSizes({ length: l * 10, width: w * 10, height: h * 10 }, allowancesOf(r)) : null
  const cm = (mm: number) => (mm / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 })
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Thickness and bulge: {r.basis === 'inside' ? `inside sizes + ${r.wall} mm walls` : 'outside sizes'}, bulge {r.bulgeTop}/{r.bulgeSide}/{r.bulgeEnd} mm
        {sizes ? ` → takes ${cm(sizes.space.length)} × ${cm(sizes.space.width)} × ${cm(sizes.space.height)} cm` : ''}
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        <Field id={`${r.key}-basis`} label="Sizes are">
          {(d) => (
            <Select id={`${r.key}-basis`} value={r.basis} onChange={(e) => set({ basis: e.target.value as Row['basis'] })} aria-describedby={d} className="px-2">
              <option value="outside">Outside</option>
              <option value="inside">Inside</option>
            </Select>
          )}
        </Field>
        {(
          [
            ['wall', 'Wall mm'],
            ['bulgeTop', 'Bulge top mm'],
            ['bulgeSide', 'Bulge sides mm'],
            ['bulgeEnd', 'Bulge ends mm'],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} id={`${r.key}-${k}`} label={label}>
            {(d) => <Input id={`${r.key}-${k}`} inputMode="decimal" value={r[k]} onChange={(e) => set({ [k]: e.target.value })} aria-describedby={d} className="px-2" disabled={k === 'wall' && r.basis === 'outside'} />}
          </Field>
        ))}
      </div>
      <p className="mt-1 text-muted-foreground">Bulge is per face: a box takes its size plus the bulge on both faces. Walls only count when the sizes are measured inside.</p>
    </details>
  )
}
