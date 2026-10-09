import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { ULDS, chargeableKg, packUld, type PackResult } from '~/lib/freight/packing'
import { useCostingSettings } from '~/lib/master/api'
import { UldView } from '~/components/freight/uld-view'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '~/components/ui/table'

export const Route = createFileRoute('/_app/load-planner')({
  head: () => ({ meta: [{ title: 'Load planner · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/load-planner')}>
      <LoadPlanner />
    </RequireRole>
  ),
})

interface BoxType {
  box_code: string
  description: string | null
  length_cm: number
  width_cm: number
  height_cm: number
}
const num = (s: string) => {
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? v : null
}
const kg = (n: number) => `${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })} kg`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function LoadPlanner() {
  const boxTypes = useQuery({
    queryKey: ['box-types-planner'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('box_types').select('box_code, description, length_cm, width_cm, height_cm').eq('active', true).order('box_code')
      if (error) throw new Error(error.message)
      return ((data ?? []) as BoxType[]).map((b) => ({ ...b, length_cm: Number(b.length_cm), width_cm: Number(b.width_cm), height_cm: Number(b.height_cm) }))
    },
  })
  const costing = useCostingSettings()
  const [uldCode, setUldCode] = React.useState('AKE')
  const [L, setL] = React.useState('100')
  const [W, setW] = React.useState('45')
  const [H, setH] = React.useState('30')
  const [weight, setWeight] = React.useState('')
  const [stems, setStems] = React.useState('')
  const [clearance, setClearance] = React.useState('2')
  const [onSide, setOnSide] = React.useState(false)
  const uld = ULDS.find((u) => u.code === uldCode)!
  const box = { l: num(L), w: num(W), h: num(H) }
  const valid = box.l && box.w && box.h
  const opts = { clearance: (num(clearance) ?? 0) * 10, allowOnSide: onSide, boxWeightKg: num(weight) }
  const plan = React.useMemo(
    () => (valid ? packUld(uld, { length: box.l! * 10, width: box.w! * 10, height: box.h! * 10 }, opts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uldCode, L, W, H, weight, clearance, onSide],
  )
  const [upTo, setUpTo] = React.useState(99)
  React.useEffect(() => setUpTo(plan?.layers.length ?? 0), [plan])
  const rate = costing.data?.freight_per_kg ?? null
  const cur = costing.data?.freight_currency ?? 'USD'

  return (
    <>
      <PageHeader
        title="Load planner"
        description="How many boxes of a size fit in an AKE or on a PMC: per layer, how many layers, and the most that fit. Drag the 3D view to turn it."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Container and box</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field id="lp-uld" label="Container" hint={uld.note}>
              {(d) => (
                <Select id="lp-uld" value={uldCode} onChange={(e) => setUldCode(e.target.value)} aria-describedby={d}>
                  {ULDS.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="lp-type" label="Start from a box type" hint="Or type the size below.">
              {(d) => (
                <Select
                  id="lp-type"
                  value=""
                  aria-describedby={d}
                  onChange={(e) => {
                    const b = boxTypes.data?.find((x) => x.box_code === e.target.value)
                    if (b) {
                      setL(String(b.length_cm))
                      setW(String(b.width_cm))
                      setH(String(b.height_cm))
                    }
                  }}
                >
                  <option value="">Choose…</option>
                  {(boxTypes.data ?? []).map((b) => (
                    <option key={b.box_code} value={b.box_code}>
                      {b.box_code}: {b.length_cm} × {b.width_cm} × {b.height_cm} cm
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <fieldset className="grid grid-cols-3 gap-2">
              <legend className="mb-1.5 text-sm font-semibold">Box size (cm)</legend>
              {(
                [
                  ['lp-l', 'Length', L, setL],
                  ['lp-w', 'Width', W, setW],
                  ['lp-h', 'Height', H, setH],
                ] as const
              ).map(([id, label, v, set]) => (
                <Field key={id} id={id} label={label}>
                  {(d) => <Input id={id} inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} aria-describedby={d} />}
                </Field>
              ))}
            </fieldset>
            <div className="grid grid-cols-2 gap-2">
              <Field id="lp-kg" label="Full box weight (kg)" hint="Optional: checks the weight limit.">
                {(d) => <Input id="lp-kg" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} aria-describedby={d} />}
              </Field>
              <Field id="lp-stems" label="Stems per box" hint="Optional: freight per stem.">
                {(d) => <Input id="lp-stems" inputMode="numeric" value={stems} onChange={(e) => setStems(e.target.value)} aria-describedby={d} />}
              </Field>
            </div>
            <Field id="lp-clear" label="Space kept free on each side (cm)" hint="Walls, net and loading room.">
              {(d) => <Input id="lp-clear" inputMode="decimal" value={clearance} onChange={(e) => setClearance(e.target.value)} aria-describedby={d} />}
            </Field>
            <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" className="size-5 accent-accent" checked={onSide} onChange={(e) => setOnSide(e.target.checked)} />
              Boxes may be turned on their side
            </label>
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4">
          {!valid && <Alert variant="warning" title="Enter the box's length, width and height in cm" />}
          {plan && valid && (
            <>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Boxes on the bottom layer" value={plan.bottomLayer} />
                <Stat label="Layers" value={plan.layers.length} sub={`${box.h ? plan.standing / 10 : ''} cm each`} />
                <Stat label="Boxes in all" value={plan.total} sub={plan.weightLimited ? 'stopped by the weight limit' : undefined} />
                <Stat label="Space used" value={pct(plan.fill)} />
              </dl>
              <Card>
                <CardContent className="grid gap-3 pt-6">
                  <UldView uld={uld} plan={plan} upTo={upTo} className="h-[26rem] w-full touch-none rounded-md border bg-muted/30" />
                  {plan.layers.length > 1 && (
                    <Field id="lp-layers" label={`Show layers 1 to ${upTo} of ${plan.layers.length}`}>
                      {(d) => (
                        <input id="lp-layers" type="range" min={1} max={plan.layers.length} value={Math.min(upTo, plan.layers.length)} onChange={(e) => setUpTo(Number(e.target.value))} aria-describedby={d} className="w-full accent-accent" />
                      )}
                    </Field>
                  )}
                  <p className="text-sm text-muted-foreground">Drag to turn, scroll or pinch to zoom. Layers alternate dark and light green.</p>
                </CardContent>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <LayerTable plan={plan} />
                <Weights plan={plan} rate={rate} cur={cur} stems={num(stems)} />
              </div>
              <Compare
                uld={uld}
                current={{ label: 'This box', l: box.l!, w: box.w!, h: box.h! }}
                types={boxTypes.data ?? []}
                opts={opts}
                rate={rate}
                cur={cur}
                onPick={(b) => {
                  setL(String(b.l))
                  setW(String(b.w))
                  setH(String(b.h))
                }}
              />
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString('en-GB') : value}</dd>
      {sub && <dd className="text-sm text-muted-foreground">{sub}</dd>}
    </div>
  )
}

function LayerTable({ plan }: { plan: PackResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Layer by layer</CardTitle>
        <CardDescription>On an AKE the bottom layers are narrower: the wing starts 51 cm up.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <caption className="sr-only">Boxes per layer</caption>
          <THead>
            <TR>
              <TH>Layer</TH>
              <TH>Height (cm)</TH>
              <TH className="text-right">Floor width (cm)</TH>
              <TH className="text-right">Boxes</TH>
            </TR>
          </THead>
          <TBody>
            {plan.layers.map((l, i) => (
              <TR key={i}>
                <TD>{i + 1}</TD>
                <TD className="tabular-nums">
                  {l.z / 10}–{(l.z + l.height) / 10}
                </TD>
                <TD className="text-right tabular-nums">{Math.round(l.floorWidth) / 10}</TD>
                <TD className="text-right tabular-nums">{l.count}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function Weights({ plan, rate, cur, stems }: { plan: PackResult; rate: number | null; cur: string; stems: number | null }) {
  const charge = chargeableKg(plan)
  const freight = rate != null ? charge * rate : null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weight and freight</CardTitle>
        <CardDescription>The airline charges the higher of actual and volumetric weight (L × W × H cm ÷ 6000 per box).</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt>Actual weight</dt>
          <dd className="text-right tabular-nums">{plan.grossKg != null ? kg(plan.grossKg) : 'enter the box weight'}</dd>
          <dt>Weight limit (payload)</dt>
          <dd className="text-right tabular-nums">{kg(plan.payloadKg)}</dd>
          <dt>Volumetric weight</dt>
          <dd className="text-right tabular-nums">{kg(plan.volumetricKg)}</dd>
          <dt className="font-semibold">Chargeable weight</dt>
          <dd className="text-right font-semibold tabular-nums">{kg(charge)}</dd>
          {freight != null && (
            <>
              <dt>
                Freight at {cur} {rate!.toFixed(2)} per kg
              </dt>
              <dd className="text-right tabular-nums">
                {cur} {freight.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
              </dd>
              <dt>Per box</dt>
              <dd className="text-right tabular-nums">
                {cur} {plan.total ? (freight / plan.total).toFixed(2) : '–'}
              </dd>
              {stems && (
                <>
                  <dt>Per stem ({(stems * plan.total).toLocaleString('en-GB')} stems)</dt>
                  <dd className="text-right tabular-nums">
                    {cur} {plan.total ? (freight / (stems * plan.total)).toFixed(4) : '–'}
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  )
}

type Candidate = { label: string; l: number; w: number; h: number }
function Compare({ uld, current, types, opts, rate, cur, onPick }: {
  uld: (typeof ULDS)[number]
  current: Candidate
  types: BoxType[]
  opts: Parameters<typeof packUld>[2]
  rate: number | null
  cur: string
  onPick: (b: Candidate) => void
}) {
  const rows = [current, ...types.map((t) => ({ label: t.box_code, l: t.length_cm, w: t.width_cm, h: t.height_cm }))].map((c) => {
    const p = packUld(uld, { length: c.l * 10, width: c.w * 10, height: c.h * 10 }, opts)
    const charge = chargeableKg(p)
    return { c, p, perBox: rate != null && p.total ? (charge * rate) / p.total : null }
  })
  const bestFill = Math.max(...rows.map((r) => r.p.fill))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare box sizes in this container</CardTitle>
        <CardDescription>Your box against the box types in ConsolFlora. The best use of space is marked.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <caption className="sr-only">Box sizes compared</caption>
          <THead>
            <TR>
              <TH>Box</TH>
              <TH>Size (cm)</TH>
              <TH className="text-right">Bottom layer</TH>
              <TH className="text-right">Layers</TH>
              <TH className="text-right">Boxes</TH>
              <TH className="text-right">Space used</TH>
              <TH className="text-right">Freight per box</TH>
              <TH>
                <span className="sr-only">Use</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows
              .sort((a, b) => b.p.fill - a.p.fill)
              .map(({ c, p, perBox }) => (
                <TR key={c.label}>
                  <TD className="font-semibold">
                    {c.label} {p.fill === bestFill && <Badge variant="success">Best fit</Badge>}
                  </TD>
                  <TD className="tabular-nums">
                    {c.l} × {c.w} × {c.h}
                  </TD>
                  <TD className="text-right tabular-nums">{p.bottomLayer}</TD>
                  <TD className="text-right tabular-nums">{p.layers.length}</TD>
                  <TD className="text-right tabular-nums">{p.total}</TD>
                  <TD className="text-right tabular-nums">{pct(p.fill)}</TD>
                  <TD className="text-right tabular-nums">{perBox != null ? `${cur} ${perBox.toFixed(2)}` : '–'}</TD>
                  <TD>
                    {c !== current && (
                      <Button variant="outline" size="sm" onClick={() => onPick(c)}>
                        Show
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}
