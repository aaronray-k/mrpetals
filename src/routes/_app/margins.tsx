import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Pencil, Plus } from 'lucide-react'
import { saveMarginRule, useIncoterms, useMarginRules, useProductNames, type MarginRule } from '~/lib/orders/api'
import { saveServiceFee, useServiceFees, type ServiceFee } from '~/lib/fees/api'
import { useAuth } from '~/lib/auth'
import { hasAnyRole } from '~/lib/roles'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/margins')({
  head: () => ({ meta: [{ title: 'Fees and margins · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/margins')}>
      <MarginsPage />
    </RequireRole>
  ),
})

type Draft = Omit<MarginRule, 'id'> & { id?: string }

const lengthBand = (r: Pick<MarginRule, 'min_length_cm' | 'max_length_cm'>) =>
  r.max_length_cm == null ? `${r.min_length_cm} cm and longer` : r.min_length_cm === 0 ? `up to ${r.max_length_cm} cm` : `${r.min_length_cm}–${r.max_length_cm} cm`

function MarginsPage() {
  const { roles } = useAuth()
  const rules = useMarginRules()
  const incoterms = useIncoterms()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = React.useState<Draft | null>(null)
  const canEdit = hasAnyRole(roles, ['admin', 'finance'])
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['margin-rules'] })

  const terms = [...new Set([...(incoterms.data ?? []), ...(rules.data ?? []).map((r) => r.incoterm)])]
  const without = terms.filter((t) => !(rules.data ?? []).some((r) => r.incoterm === t && r.active))

  return (
    <>
      <PageHeader
        title="Fees and margins"
        description="ConsolFlora's rate card: the fee per stem for each incoterm and stem length, and the fee per shipment for each service."
        actions={
          canEdit && (
            <Button onClick={() => setEditing({ incoterm: incoterms.data?.[0] ?? 'FOB', flower_type: null, min_length_cm: 0, max_length_cm: null, margin_per_stem: 0, currency: null, active: true })}>
              <Plus aria-hidden="true" /> Add a per-stem rule
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="margins.rules" title="How fees work">
          Each buyer has a service (set on the Customers page). Sourcing and Full package buyers pay the fee per stem for their incoterm and
          stem length. Consolidation, Intake and quality checks, and Full package buyers pay a fee per shipment, added once per flight to their
          first order. Per-stem fees with no currency are the same figure in euros or US dollars. For the same incoterm, a rule for a flower
          type beats one for any flower, and a narrower length band beats a wider one. Changes apply to new orders only.
        </Tip>
        {!canEdit && <Alert title="Only Admin and Finance users can change fees." />}
        <ServiceFeesCard canEdit={canEdit} />
        {without.length > 0 && rules.data && (
          <Alert variant="warning" title={`No margin rules for ${without.join(', ')}`}>
            Orders on {without.length === 1 ? 'this incoterm' : 'these incoterms'} start without a margin, and staff must enter it on each line.
          </Alert>
        )}
        {rules.isLoading && <Spinner />}
        {rules.error && (
          <Alert variant="destructive" title="Couldn't load margins" role="alert">
            {(rules.error as Error).message}
          </Alert>
        )}
        {terms
          .filter((t) => (rules.data ?? []).some((r) => r.incoterm === t))
          .map((t) => (
            <Card key={t}>
              <CardHeader>
                <CardTitle>{t}</CardTitle>
                <CardDescription>Fee per stem on {t} orders (Sourcing and Full package buyers).</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <caption className="sr-only">{t} margin rules</caption>
                    <THead>
                      <TR>
                        <TH>Flowers</TH>
                        <TH>Stem length</TH>
                        <TH className="text-right">Fee per stem</TH>
                        <TH>Currency</TH>
                        <TH>Status</TH>
                        {canEdit && (
                          <TH>
                            <span className="sr-only">Actions</span>
                          </TH>
                        )}
                      </TR>
                    </THead>
                    <TBody>
                      {(rules.data ?? [])
                        .filter((r) => r.incoterm === t)
                        .map((r) => (
                          <TR key={r.id} className={r.active ? undefined : 'text-muted-foreground'}>
                            <TD>{r.flower_type ?? 'Any flower'}</TD>
                            <TD>{lengthBand(r)}</TD>
                            <TD className="text-right tabular-nums">{r.margin_per_stem.toFixed(4)}</TD>
                            <TD>{r.currency ?? 'Same in € or US$'}</TD>
                            <TD>{r.active ? <Badge variant="success">Active</Badge> : <Badge>Off</Badge>}</TD>
                            {canEdit && (
                              <TD className="text-right">
                                <Button variant="ghost" size="sm" onClick={() => setEditing({ ...r })}>
                                  <Pencil aria-hidden="true" /> Edit<span className="sr-only"> {t} rule for {r.flower_type ?? 'any flower'}, {lengthBand(r)}</span>
                                </Button>
                              </TD>
                            )}
                          </TR>
                        ))}
                    </TBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
      {editing && (
        <RuleDialog
          draft={editing}
          incoterms={terms}
          onClose={() => setEditing(null)}
          onSave={async (d) => {
            await saveMarginRule(d)
            toast({ kind: 'success', title: 'Per-stem fee saved' })
            setEditing(null)
            refresh()
          }}
        />
      )}
    </>
  )
}

function RuleDialog({ draft, incoterms, onClose, onSave }: { draft: Draft; incoterms: string[]; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const products = useProductNames()
  const flowerTypes = [...new Set((products.data ?? []).map((p) => p.flower_type))].sort()
  const [incoterm, setIncoterm] = React.useState(draft.incoterm)
  const [flower, setFlower] = React.useState(draft.flower_type ?? '')
  const [min, setMin] = React.useState(String(draft.min_length_cm))
  const [max, setMax] = React.useState(draft.max_length_cm == null ? '' : String(draft.max_length_cm))
  const [margin, setMargin] = React.useState(draft.id ? String(draft.margin_per_stem) : '')
  const [active, setActive] = React.useState(draft.active)
  const [currency, setCurrency] = React.useState(draft.currency ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const minN = Number(min || 0)
    const maxN = max.trim() === '' ? null : Number(max)
    const marginN = Number(margin)
    if (!Number.isInteger(minN) || minN < 0) return setError('Shortest stem must be a whole number of cm, 0 or more.')
    if (maxN != null && (!Number.isInteger(maxN) || maxN < minN)) return setError('Longest stem must be a whole number, at least the shortest. Leave it empty for no limit.')
    if (margin.trim() === '' || !Number.isFinite(marginN) || marginN < 0) return setError('Enter the fee per stem, like 0.02.')
    setBusy(true)
    setError(null)
    try {
      await onSave({ id: draft.id, incoterm, flower_type: flower.trim() || null, min_length_cm: minN, max_length_cm: maxN, margin_per_stem: marginN, currency: currency || null, active })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={draft.id ? 'Edit per-stem fee' : 'Add a per-stem fee'}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        {error && <Alert variant="destructive" title={error} role="alert" />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rule-incoterm" label="Incoterm">
            {(d) => (
              <Select id="rule-incoterm" value={incoterm} onChange={(e) => setIncoterm(e.target.value)} aria-describedby={d}>
                {incoterms.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="rule-flower" label="Flower type" hint="Leave empty for any flower.">
            {(d) => (
              <>
                <Input id="rule-flower" list="rule-flowers" value={flower} onChange={(e) => setFlower(e.target.value)} aria-describedby={d} />
                <datalist id="rule-flowers">
                  {flowerTypes.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field id="rule-min" label="Shortest stem (cm)">
            {(d) => <Input id="rule-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} aria-describedby={d} />}
          </Field>
          <Field id="rule-max" label="Longest stem (cm)" hint="Leave empty for no limit.">
            {(d) => <Input id="rule-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} aria-describedby={d} />}
          </Field>
          <Field id="rule-margin" label="Fee per stem">
            {(d) => <Input id="rule-margin" inputMode="decimal" value={margin} placeholder="0.02" onChange={(e) => setMargin(e.target.value)} aria-describedby={d} />}
          </Field>
          <Field id="rule-currency" label="Currency" hint="Same figure in every currency, or converted from one currency.">
            {(d) => (
              <Select id="rule-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-describedby={d}>
                <option value="">Same in € or US$</option>
                {['USD', 'EUR', 'KES', 'GBP', 'JPY'].map((c) => (
                  <option key={c} value={c}>
                    {c}, converted for other currencies
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Switch checked={active} onCheckedChange={setActive} label="Rule is active" />
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> New orders use the change. Orders already placed keep their margins.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save rule'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Per-shipment fee and whether the per-stem fee applies, for each service. */
function ServiceFeesCard({ canEdit }: { canEdit: boolean }) {
  const fees = useServiceFees()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Services</CardTitle>
        <CardDescription>What each service pays. Fees per shipment are the same figure in € or US$.</CardDescription>
      </CardHeader>
      <CardContent>
        {fees.isLoading && <Spinner />}
        {fees.error && <Alert variant="destructive" title="Couldn't load the fees" role="alert">{(fees.error as Error).message}</Alert>}
        {fees.data && (
          <div className="rounded-md border">
            <Table>
              <caption className="sr-only">Fees per service</caption>
              <THead>
                <TR>
                  <TH>Service</TH>
                  <TH>Fee per stem</TH>
                  <TH>Fee per shipment</TH>
                  <TH>On the proforma as</TH>
                  {canEdit && (
                    <TH>
                      <span className="sr-only">Save</span>
                    </TH>
                  )}
                </TR>
              </THead>
              <TBody>
                {fees.data.map((f) => (
                  <ServiceFeeRow key={`${f.service}-${f.fee_per_shipment}-${f.per_stem}-${f.fee_description}`} fee={f} canEdit={canEdit} />
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ServiceFeeRow({ fee, canEdit }: { fee: ServiceFee; canEdit: boolean }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [perStem, setPerStem] = React.useState(fee.per_stem)
  const [amount, setAmount] = React.useState(String(fee.fee_per_shipment))
  const [desc, setDesc] = React.useState(fee.fee_description ?? '')
  const dirty = perStem !== fee.per_stem || Number(amount) !== fee.fee_per_shipment || desc !== (fee.fee_description ?? '')
  if (!canEdit)
    return (
      <TR>
        <TD className="font-semibold">{fee.label}</TD>
        <TD>{fee.per_stem ? 'Yes, by incoterm' : 'No'}</TD>
        <TD className="tabular-nums">{fee.fee_per_shipment ? fee.fee_per_shipment.toFixed(2) : '—'}</TD>
        <TD>{fee.fee_description ?? '—'}</TD>
      </TR>
    )
  return (
    <TR>
      <TD className="font-semibold">{fee.label}</TD>
      <TD>
        <label className="inline-flex min-h-10 items-center gap-2">
          <input type="checkbox" className="size-6 shrink-0 accent-accent" checked={perStem} onChange={(e) => setPerStem(e.target.checked)} />
          <span>
            Yes<span className="sr-only">, {fee.label} pays the fee per stem</span>
          </span>
        </label>
      </TD>
      <TD>
        <label className="sr-only" htmlFor={`fee-${fee.service}`}>
          Fee per shipment for {fee.label}
        </label>
        <Input id={`fee-${fee.service}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" />
      </TD>
      <TD>
        <label className="sr-only" htmlFor={`fee-desc-${fee.service}`}>
          How the {fee.label} fee shows on the proforma
        </label>
        <Input id={`fee-desc-${fee.service}`} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Not charged" className="min-w-48" />
      </TD>
      <TD>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty}
          onClick={async () => {
            const n = Number(amount)
            if (!Number.isFinite(n) || n < 0) return toast({ kind: 'error', title: 'Enter a fee of 0 or more' })
            if (n > 0 && !desc.trim()) return toast({ kind: 'error', title: 'Say how the fee shows on the proforma' })
            try {
              await saveServiceFee(fee.service, { per_stem: perStem, fee_per_shipment: n, fee_description: desc.trim() || null })
              toast({ kind: 'success', title: `${fee.label} fees saved`, description: 'New orders use them; orders already placed keep theirs.' })
              void queryClient.invalidateQueries({ queryKey: ['service-fees'] })
            } catch (e) {
              toast({ kind: 'error', title: 'Not saved', description: (e as Error).message })
            }
          }}
        >
          Save<span className="sr-only"> {fee.label} fees</span>
        </Button>
      </TD>
    </TR>
  )
}
