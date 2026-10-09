import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { useAuth } from '~/lib/auth'
import { hasAnyRole } from '~/lib/roles'
import { accuracy, loadingFactor, suggestBulge, type BoxSpec, type LoadCheck } from '~/lib/freight/calibrate'
import type { ShipmentPlan } from '~/lib/freight/mixed'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { useToast } from '~/components/ui/toaster'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/**
 * After loading: how many boxes really went into each container, against the plan. The record tunes the planner:
 * its accuracy over recent loads, and the bulge figure that would have matched them.
 */
export function LoadChecks({ plan, specs, airline, shipmentId }: { plan: ShipmentPlan; specs: BoxSpec[]; airline: string; shipmentId: string | null }) {
  const { roles } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const canRecord = hasAnyRole(roles, ['admin', 'consolidator', 'qc', 'senior_qc'])
  const canTune = hasAnyRole(roles, ['admin', 'consolidator'])
  const [actual, setActual] = React.useState<Record<number, string>>({})
  const checks = useQuery({
    queryKey: ['load-checks'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('load_checks').select('planned_boxes, actual_boxes, plan, created_at, uld_code, airline').order('created_at', { ascending: false }).limit(60)
      if (error) throw new Error(error.message)
      return (data ?? []).map((c: { planned_boxes: number; actual_boxes: number; plan: LoadCheck['plan']; created_at: string; uld_code: string; airline: string | null }) => ({
        planned: c.planned_boxes,
        actual: c.actual_boxes,
        plan: c.plan,
        at: c.created_at,
        uld: c.uld_code,
        airline: c.airline,
      }))
    },
  })
  const list = checks.data ?? []
  const acc = accuracy(list)
  const factor = loadingFactor(list)
  const tune = React.useMemo(() => (list.length ? suggestBulge(list) : null), [list])

  // The box types to change, with the top and side bulge that matched (absolute, so applying twice changes nothing).
  const targets = React.useMemo(() => {
    if (!tune || !tune.deltaMm) return []
    const seen = new Map<string, { top: number; side: number }>()
    for (const c of list) for (const l of c.plan.lines) if (!seen.has(l.label)) seen.set(l.label, { top: Math.max(0, l.allowances.bulgeTopMm + tune.deltaMm), side: Math.max(0, l.allowances.bulgeSideMm + tune.deltaMm) })
    return [...seen].map(([label, v]) => ({ label, ...v }))
  }, [list, tune])

  return (
    <Card>
      <CardHeader>
        <CardTitle>What really went in</CardTitle>
        <CardDescription>
          After loading, enter how many boxes each container really took. The planner learns from these: its accuracy over recent loads, and the bulge that would
          have matched them.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {canRecord && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              const rows = plan.loads
                .map((load, i) => ({ i, load, n: Number(actual[i]) }))
                .filter((r) => actual[r.i] !== undefined && actual[r.i] !== '' && Number.isInteger(r.n) && r.n >= 0)
              if (!rows.length) return toast({ kind: 'error', title: 'Enter the boxes that really went into at least one container' })
              const payload = rows.map(({ i, load, n }) => {
                // The boxes still to load when this container was filled (all, less those in earlier containers):
                // re-running the plan on them fills this container again the same way, or differently with another bulge.
                const earlier = plan.loads.slice(0, i).flatMap((l) => l.boxes)
                const counts = specs.map((s, li) => s.count - earlier.filter((b) => b.line === li).length)
                return {
                  shipment_id: shipmentId,
                  airline,
                  uld_code: plan.uld.code,
                  planned_boxes: load.boxes.length,
                  actual_boxes: n,
                  plan: { uldCode: plan.uld.code, options: plan.options, lines: specs.map((s, li) => ({ ...s, count: counts[li] ?? 0 })).filter((s) => s.count > 0) },
                }
              })
              const { error } = await getSupabase().from('load_checks').insert(payload)
              if (error) return toast({ kind: 'error', title: 'Not saved', description: error.message })
              toast({ kind: 'success', title: `${payload.length} load ${payload.length === 1 ? 'check' : 'checks'} saved` })
              setActual({})
              void queryClient.invalidateQueries({ queryKey: ['load-checks'] })
            }}
          >
            {plan.loads.map((load, i) => (
              <Field key={i} id={`lc-${i}`} label={`${plan.uld.code} ${i + 1}: planned ${load.boxes.length}`}>
                {(d) => <Input id={`lc-${i}`} inputMode="numeric" placeholder="Really went in" value={actual[i] ?? ''} onChange={(e) => setActual({ ...actual, [i]: e.target.value })} aria-describedby={d} className="w-40" />}
              </Field>
            ))}
            <Button type="submit" variant="outline">
              Save what went in
            </Button>
          </form>
        )}

        {acc == null ? (
          <p className="text-sm text-muted-foreground">No loads recorded yet. Record a few and the planner&apos;s accuracy shows here.</p>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm">
              Accuracy over the last {list.length} {list.length === 1 ? 'container' : 'containers'}: <strong className="tabular-nums">{pct(acc)}</strong> (planned against what
              really went in).
            </p>
            {factor != null && Math.abs(factor - 1) >= 0.005 && (
              <p className="text-sm">
                Real loads have come to <strong className="tabular-nums">{pct(factor)}</strong> of the plan: expect about{' '}
                <strong className="tabular-nums">{Math.round((plan.loads[0]?.boxes.length ?? 0) * factor)}</strong> boxes in a full {plan.uld.code}, where the plan
                says {plan.loads[0]?.boxes.length ?? 0}
                {factor > 1 ? ' (more went in than planned: the bulge figures may be too high)' : ' (gaps left by hand, uneven boxes)'}.
              </p>
            )}
            {tune && tune.deltaMm !== 0 && tune.after > tune.before && (
              <Alert variant={tune.before < 0.98 ? 'warning' : 'info'} title={`Bulge ${tune.deltaMm > 0 ? '+' : ''}${tune.deltaMm} mm per face would have matched better`}>
                <p>
                  With the top and side bulge {tune.deltaMm > 0 ? 'raised' : 'lowered'} by {Math.abs(tune.deltaMm)} mm, these loads would have been planned with {pct(tune.after)} accuracy
                  instead of {pct(tune.before)}.
                </p>
                {canTune && targets.length > 0 && (
                  <Button
                    className="mt-2"
                    variant="outline"
                    onClick={async () => {
                      const sb = getSupabase()
                      let changed = 0
                      for (const t of targets) {
                        const { data, error } = await sb.from('box_types').update({ bulge_top_mm: t.top, bulge_side_mm: t.side }).eq('box_code', t.label).select('id')
                        if (error) return toast({ kind: 'error', title: `${t.label} not changed`, description: error.message })
                        changed += data?.length ?? 0
                      }
                      toast({ kind: 'success', title: changed ? `Bulge updated on ${changed} box ${changed === 1 ? 'type' : 'types'}` : 'No matching box types', description: targets.map((t) => `${t.label}: top ${t.top} mm, sides ${t.side} mm`).join('; ') })
                      void queryClient.invalidateQueries({ queryKey: ['load-planner-lookups'] })
                    }}
                  >
                    Apply to {targets.map((t) => t.label).join(', ')}
                  </Button>
                )}
              </Alert>
            )}
            {tune && tune.deltaMm === 0 && <p className="text-sm text-muted-foreground">The bulge figures match the recorded loads as well as any change would.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
