import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Send, X } from 'lucide-react'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import {
decideClaimCost,
  decideClaimLine,
  finishClaimReview,
openCreditNoteDocument,
  useClaim,
  type BoxQc,
  type ClaimCost,
  type ClaimLine,
} from '~/lib/claims/api'
import { useQcReasons } from '~/lib/qc/api'
import { pushToOdoo } from '~/lib/odoo/api'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { ClaimStatusBadge, DecisionBadge, PhotoGrid } from '~/components/claims/claim-parts'
import { NoticeCard } from '~/components/claims/notice-card'
import { BoxPhotosButton } from '~/components/qc/box-photos'
import { QcBadge } from '~/components/qc/qc-badge'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/claims/$claimId')({
  head: () => ({ meta: [{ title: 'Claim review · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/claims')}>
      <ClaimReview />
    </RequireRole>
  ),
})

function ClaimReview() {
  const { claimId } = Route.useParams()
  const { roles } = useAuth()
  const canDecide = hasAnyRole(roles, STAFF_ROLES)
  const q = useClaim(claimId, true)
  const reasons = useQcReasons()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <Alert variant="destructive" title="Couldn't load the claim" role="alert">{(q.error as Error)?.message}</Alert>
  const { claim, lines, costs, photos, boxes, notices } = q.data
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['claim', claimId] })
    void queryClient.invalidateQueries({ queryKey: ['claims'] })
  }
  const label = (code: string) => reasons.data?.find((r) => r.code === code)?.label ?? code
  const open = claim.status === 'submitted'
  const pending = lines.filter((l) => l.decision === 'pending').length + costs.filter((c) => c.decision === 'pending').length
  const farms = [...new Map(boxes.map((b) => [b.farm_id, b.farm_name ?? 'Farm'])).entries()]
  const approved = lines.reduce((s, l) => s + (l.approved_amount ?? 0), 0) + costs.reduce((s, c) => s + (c.approved_amount ?? 0), 0)

  return (
    <>
      <PageHeader
        title={`Claim ${claim.claim_number}`}
        description={`${claim.customers?.company_name} · shipment ${claim.shipments?.shipment_ref} · reported ${formatDateTime(claim.submitted_at)}`}
        actions={<ClaimStatusBadge status={claim.status} />}
      />
      <div className="grid grid-cols-1 gap-4">
        {claim.note && <Alert title="Buyer's note">{claim.note}</Alert>}
        {lines.map((l) => (
          <LineReview
            key={l.id}
            line={l}
            box={boxes.find((b) => b.id === l.box_id)}
            photos={photos.filter((p) => p.claim_line_id === l.id)}
            currency={claim.currency}
            reasonLabel={label(l.reason)}
            labelOf={label}
            editable={open && canDecide}
            onDone={refresh}
          />
        ))}
        {costs.map((c) => (
          <CostReview key={c.id} cost={c} currency={claim.currency} farms={farms} editable={open && canDecide} onDone={refresh} />
        ))}

        {open && canDecide && (
          <Card>
            <CardHeader>
              <CardTitle>Finish the review</CardTitle>
              <CardDescription>
                {pending ? `${pending} still to decide.` : `Approved: ${money(approved, claim.currency)}. The buyer gets a credit note, and each farm with approved boxes gets a claim notice.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field id="finish-note" label="Message to the buyer (optional)">
                {(d) => <Input id="finish-note" value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={d} />}
              </Field>
              <Button
                size="lg"
                className="justify-self-start"
                disabled={busy || pending > 0}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await finishClaimReview(claim.id, note)
                    // The buyer's credit note goes to Odoo as a credit note (failures wait on the Invoices page).
                    if (r.credit_note) void pushToOdoo().catch(() => {})
                    toast({
                      kind: 'success',
                      title: 'Claim decided',
                      description: `${r.credit_note ? `Credit note ${r.credit_note} for ${money(r.amount, claim.currency)}. ` : ''}${r.notices} ${r.notices === 1 ? 'farm' : 'farms'} sent a claim notice.`,
                    })
                    refresh()
                  } catch (e) {
                    toast({ kind: 'error', title: 'Not finished', description: (e as Error).message })
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Send aria-hidden="true" /> Finish and send to farms
              </Button>
            </CardContent>
          </Card>
        )}

        {claim.status === 'decided' && (
          <>
            {claim.credit_notes[0] ? (
              <Alert variant="success" title={`Credit note ${claim.credit_notes[0].credit_note_number} to the buyer: ${money(claim.credit_notes[0].amount, claim.currency)}`} />
            ) : (
              <Alert title="Nothing approved: no credit note." />
            )}
            {notices.map((n) => (
              <NoticeCard key={n.id} notice={n} canAct={canDecide} onDone={refresh} />
            ))}
          </>
        )}
      </div>
    </>
  )
}

function LineReview({
  line,
  box,
  photos,
  currency,
  reasonLabel,
  labelOf,
  editable,
  onDone,
}: {
  line: ClaimLine
  box: BoxQc | undefined
  photos: { id: string; claim_line_id: string | null; url: string | null }[]
  currency: string
  reasonLabel: string
  labelOf: (code: string) => string
  editable: boolean
  onDone: () => void
}) {
  const toast = useToast()
  const [stems, setStems] = React.useState(String(line.approved_stems ?? line.stems))
  const [note, setNote] = React.useState(line.decision_note ?? '')
  const [busy, setBusy] = React.useState(false)
  async function decide(approve: boolean) {
    setBusy(true)
    try {
      await decideClaimLine(line.id, approve, approve ? Number(stems) : null, note)
      onDone()
    } catch (e) {
      toast({ kind: 'error', title: 'Not saved', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Box {String(line.box_id).padStart(8, '0')} · {box?.farm_name}
          </CardTitle>
          <DecisionBadge decision={line.decision} />
        </div>
        <CardDescription>
          {box?.po_number} · {reasonLabel} · {line.stems} stems · {money(line.claimed_amount, currency)} ({money(line.price_per_stem, currency, 3)} per stem)
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <section className="grid content-start gap-2">
          <h3 className="font-semibold">Buyer</h3>
          {line.note && <p>{line.note}</p>}
          <PhotoGrid photos={photos} label={`Buyer's photos of box ${line.box_id}`} />
          {!photos.length && <p className="text-sm text-muted-foreground">No photos.</p>}
        </section>
        <section className="grid content-start gap-2">
          <h3 className="font-semibold">ConsolFlora QC before the flight</h3>
          {box ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <QcBadge box={box} />
                {box.qc_reasons.length > 0 && <span className="text-sm">{box.qc_reasons.map(labelOf).join(', ')}</span>}
              </div>
              {box.qc_note && <p className="text-sm">{box.qc_note}</p>}
              <BoxPhotosButton boxId={box.id} count={box.photo_count} label={`QC photos of box ${box.id}`} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No QC record.</p>
          )}
        </section>
        {editable ? (
          <div className="grid gap-3 border-t pt-3 lg:col-span-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <Field id={`as-${line.id}`} label="Stems to approve">
              {(d) => <Input id={`as-${line.id}`} inputMode="numeric" value={stems} onChange={(e) => setStems(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id={`an-${line.id}`} label="Reason the buyer sees (needed to deny)">
              {(d) => <Input id={`an-${line.id}`} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={d} />}
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => decide(true)}>
                <Check aria-hidden="true" /> Approve<span className="sr-only"> box {line.box_id}</span>
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
                <X aria-hidden="true" /> Deny<span className="sr-only"> box {line.box_id}</span>
              </Button>
            </div>
          </div>
        ) : (
          line.decision !== 'pending' && (
            <p className="border-t pt-3 lg:col-span-2">
              {line.decision === 'approved' ? `Approved ${line.approved_stems} stems, ${money(line.approved_amount ?? 0, currency)}.` : 'Denied.'} {line.decision_note}
            </p>
          )
        )}
      </CardContent>
    </Card>
  )
}

function CostReview({ cost, currency, farms, editable, onDone }: { cost: ClaimCost; currency: string; farms: [string, string][]; editable: boolean; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = React.useState(String(cost.approved_amount ?? cost.amount))
  const [farm, setFarm] = React.useState(cost.farm_id ?? farms[0]?.[0] ?? '')
  const [note, setNote] = React.useState(cost.decision_note ?? '')
  async function decide(approve: boolean) {
    try {
      await decideClaimCost(cost.id, approve, approve ? Number(amount) : null, approve ? farm : null, note)
      onDone()
    } catch (e) {
      toast({ kind: 'error', title: 'Not saved', description: (e as Error).message })
    }
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Extra cost: {cost.description}</CardTitle>
          <DecisionBadge decision={cost.decision} />
        </div>
        <CardDescription>Claimed {money(cost.amount, currency)}</CardDescription>
      </CardHeader>
      {editable && (
        <CardContent className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
          <Field id={`ca-${cost.id}`} label="Approve">
            {(d) => <Input id={`ca-${cost.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby={d} />}
          </Field>
          <Field id={`cf-${cost.id}`} label="Charged to farm">
            {(d) => (
              <Select id={`cf-${cost.id}`} value={farm} onChange={(e) => setFarm(e.target.value)} aria-describedby={d}>
                {farms.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id={`cn-${cost.id}`} label="Reason (needed to deny)">
            {(d) => <Input id={`cn-${cost.id}`} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={d} />}
          </Field>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => decide(true)}>
              <Check aria-hidden="true" /> Approve<span className="sr-only"> {cost.description}</span>
            </Button>
            <Button variant="outline" onClick={() => decide(false)}>
              <X aria-hidden="true" /> Deny<span className="sr-only"> {cost.description}</span>
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
