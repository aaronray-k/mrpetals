import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { uploadClaimPhoto, useClaim, withdrawClaim } from '~/lib/claims/api'
import { useQcReasons } from '~/lib/qc/api'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { ClaimStatusBadge, DecisionBadge, PhotoGrid } from '~/components/claims/claim-parts'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input, Label } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/my-claims/$claimId')({
  head: () => ({ meta: [{ title: 'Claim · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/my-claims')}>
      <BuyerClaim />
    </RequireRole>
  ),
})

function BuyerClaim() {
  const { claimId } = Route.useParams()
  const q = useClaim(claimId, false)
  const reasons = useQcReasons()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <Alert variant="destructive" title="Couldn't load the claim" role="alert">{(q.error as Error)?.message}</Alert>
  const { claim, lines, costs, photos } = q.data
  const label = (code: string) => reasons.data?.find((r) => r.code === code)?.label ?? code
  const credit = claim.credit_notes[0]
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['claim', claimId] })

  return (
    <>
      <PageHeader
        title={`Claim ${claim.claim_number}`}
        description={`Shipment ${claim.shipments?.shipment_ref} · reported ${formatDateTime(claim.submitted_at)}`}
        actions={<ClaimStatusBadge status={claim.status} />}
      />
      <div className="grid grid-cols-1 gap-4">
        {claim.status === 'decided' && (
          <Alert variant={credit ? 'success' : 'info'} title={credit ? `Credit note ${credit.credit_note_number}: ${money(credit.amount, claim.currency)}` : 'No credit this time'}>
            {credit ? 'It will be taken off a future invoice.' : 'See the reasons below.'} {claim.decision_note}
          </Alert>
        )}
        {lines.map((l) => (
          <Card key={l.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Box {String(l.box_id).padStart(8, '0')}</CardTitle>
                <DecisionBadge decision={l.decision} />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p>
                {label(l.reason)} · {l.stems} stems · {money(l.claimed_amount, claim.currency)}
                {l.note ? ` · ${l.note}` : ''}
              </p>
              {l.decision === 'approved' && (
                <p>
                  Approved: {l.approved_stems} stems, {money(l.approved_amount ?? 0, claim.currency)}
                  {l.decision_note ? `. ${l.decision_note}` : ''}
                </p>
              )}
              {l.decision === 'denied' && <p>Not approved: {l.decision_note}</p>}
              <PhotoGrid photos={photos.filter((p) => p.claim_line_id === l.id)} label={`Your photos of box ${l.box_id}`} />
              {claim.status === 'submitted' && (
                <div className="grid gap-1.5 sm:max-w-sm">
                  <Label htmlFor={`more-${l.id}`}>Add photos</Label>
                  <Input
                    id={`more-${l.id}`}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    disabled={busy}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? [])
                      if (!files.length) return
                      setBusy(true)
                      try {
                        for (const f of files) await uploadClaimPhoto(claim.id, l.id, f)
                        toast({ kind: 'success', title: `${files.length} ${files.length === 1 ? 'photo' : 'photos'} added` })
                        refresh()
                      } catch (err) {
                        toast({ kind: 'error', title: 'Photo not added', description: (err as Error).message })
                      } finally {
                        setBusy(false)
                        e.target.value = ''
                      }
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {costs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Extra costs</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2">
                {costs.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    {c.description}: {money(c.amount, claim.currency)} <DecisionBadge decision={c.decision} />
                    {c.decision === 'approved' && c.approved_amount !== c.amount && ` (${money(c.approved_amount ?? 0, claim.currency)} approved)`}
                    {c.decision_note && <span className="text-muted-foreground">{c.decision_note}</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {claim.status === 'submitted' && (
          <Button
            variant="outline"
            className="justify-self-start"
            onClick={async () => {
              if (!window.confirm('Withdraw this claim? ConsolFlora will not review it.')) return
              try {
                await withdrawClaim(claim.id)
                toast({ kind: 'success', title: 'Claim withdrawn' })
                refresh()
                void queryClient.invalidateQueries({ queryKey: ['claims'] })
              } catch (err) {
                toast({ kind: 'error', title: 'Not withdrawn', description: (err as Error).message })
              }
            }}
          >
            Withdraw claim
          </Button>
        )}
      </div>
    </>
  )
}
