import * as React from 'react'
import { assumptionEffects, fullContainer, NOT_MODELLED, stemsEffect } from '~/lib/freight/assumptions'
import type { BoxSpec } from '~/lib/freight/calibrate'
import type { MixedOptions } from '~/lib/freight/mixed'
import type { Uld } from '~/lib/freight/packing'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '~/components/ui/table'

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n * 100).toFixed(1)}%`
const num0 = (s: string) => {
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * Every assumption in the plan, and how much it moves the estimate: boxes in a full container with it against
 * without it. Then stems: a bulging box holds more stems, which can make up for fewer boxes.
 */
export function AssumptionsPanel({ uld, specs, options, rate, currency }: { uld: Uld; specs: BoxSpec[]; options: MixedOptions; rate: number | null; currency: string }) {
  const [stems, setStems] = React.useState('')
  const [extra, setExtra] = React.useState('0')
  const r = React.useMemo(() => assumptionEffects(uld, specs, options), [uld, specs, options])
  const full = React.useMemo(() => fullContainer(uld, specs, options), [uld, specs, options])
  const noBulge = r.effects.find((e) => e.key === 'bulge')!.boxesWithout
  const freight = rate != null ? Math.max(full.grossKg, full.volumetricKg) * rate : null
  const st = num0(stems) ? stemsEffect(r.base, noBulge, num0(stems), num0(extra), freight) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assumptions and their effect</CardTitle>
        <CardDescription>
          Measured on a full {uld.code} of this box mix: {r.base} boxes with every assumption. Each row plans it again without that one assumption. Space works in
          steps: a small bulge may cost nothing until a whole layer or row no longer fits, then it costs that row.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="overflow-x-auto">
          <Table>
            <caption className="sr-only">Assumptions and their effect on boxes per container</caption>
            <THead>
              <TR>
                <TH>Assumption</TH>
                <TH>As used</TH>
                <TH className="text-right">Boxes without it</TH>
                <TH className="text-right">Effect</TH>
              </TR>
            </THead>
            <TBody>
              {r.effects.map((e) => (
                <TR key={e.key}>
                  <TD className="font-semibold">{e.label}</TD>
                  <TD className="text-sm">
                    {e.used}
                    <span className="block text-muted-foreground">{e.note}</span>
                  </TD>
                  <TD className="text-right tabular-nums">{e.boxesWithout}</TD>
                  <TD className="text-right font-semibold tabular-nums">{signed(e.effect)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>

        <section className="grid gap-2">
          <h3 className="font-semibold">Stems: does bulging pay for itself?</h3>
          <p className="text-sm text-muted-foreground">
            A box that bulges usually holds more stems. Enter the usual stems per box and how many more a bulging box takes, to compare stems shipped per container and
            freight per stem against ideal flat boxes.
          </p>
          <div className="flex flex-wrap gap-3">
            <Field id="as-stems" label="Stems per box (usual)">
              {(d) => <Input id="as-stems" inputMode="numeric" value={stems} onChange={(e) => setStems(e.target.value)} aria-describedby={d} className="w-32" />}
            </Field>
            <Field id="as-extra" label="More stems in a bulging box (%)">
              {(d) => <Input id="as-extra" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} aria-describedby={d} className="w-32" />}
            </Field>
          </div>
          {st && (
            <dl className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 text-sm">
              <dt />
              <dd className="font-semibold">As packed (bulging)</dd>
              <dd className="font-semibold">Ideal flat boxes</dd>
              <dt>Boxes per {uld.code}</dt>
              <dd className="tabular-nums">{r.base}</dd>
              <dd className="tabular-nums">{noBulge}</dd>
              <dt>Stems per {uld.code}</dt>
              <dd className="tabular-nums">{st.withStems.toLocaleString('en-GB')}</dd>
              <dd className="tabular-nums">{st.idealStems.toLocaleString('en-GB')}</dd>
              {st.perStemWith != null && (
                <>
                  <dt>Freight per stem</dt>
                  <dd className="tabular-nums">
                    {currency} {st.perStemWith.toFixed(4)}
                  </dd>
                  <dd className="tabular-nums">
                    {currency} {st.perStemIdeal!.toFixed(4)}
                  </dd>
                </>
              )}
              <dt className="font-semibold">Stems shipped, bulging against flat</dt>
              <dd className="col-span-2 font-semibold tabular-nums">{signed(st.change)}</dd>
            </dl>
          )}
        </section>

        <section className="grid gap-2">
          <h3 className="font-semibold">Not in the model yet</h3>
          <p className="text-sm text-muted-foreground">Factors raised in flower freight that this plan does not count. Load checks show how much they cost in practice.</p>
          <ul className="grid gap-1 text-sm">
            {NOT_MODELLED.map((f) => (
              <li key={f.label}>
                <strong>{f.label}:</strong> {f.risk}
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  )
}
