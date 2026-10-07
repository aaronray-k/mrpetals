import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useClaims, type ClaimStatus } from '~/lib/claims/api'
import { formatDateTime, cn } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { ClaimStatusBadge } from '~/components/claims/claim-parts'
import { money } from '~/components/shop/money'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Card } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export const Route = createFileRoute('/_app/claims/')({
  head: () => ({ meta: [{ title: 'Claims · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/claims')}>
      <ClaimsPage />
    </RequireRole>
  ),
})

const FILTERS: { key: ClaimStatus | 'all'; label: string }[] = [
  { key: 'submitted', label: 'To review' },
  { key: 'decided', label: 'Decided' },
  { key: 'all', label: 'All' },
]

function ClaimsPage() {
  const claims = useClaims()
  const [filter, setFilter] = React.useState<ClaimStatus | 'all'>('submitted')
  const rows = (claims.data ?? []).filter((c) => filter === 'all' || c.status === filter)
  return (
    <>
      <PageHeader title="Claims" description="Buyer claims: review each box, then the approved lines go to the farms as claim notices." />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="claims.staff" title="Reviewing a claim">
          Open a claim to see the buyer's photos next to ConsolFlora's QC result and photos for the same box. Approve or deny each box (with a
          reason the buyer sees), and say which farm caused any extra cost. Finishing the review gives the buyer a credit note and sends each
          farm a claim notice for its boxes, at its own price.
        </Tip>
        <fieldset className="flex w-fit gap-1 rounded-md border border-input bg-card p-1">
          <legend className="sr-only">Show</legend>
          {FILTERS.map((f) => (
            <label
              key={f.key}
              className={cn('inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', filter === f.key && 'bg-accent/20')}
            >
              <input type="radio" name="claims-filter" className="sr-only" checked={filter === f.key} onChange={() => setFilter(f.key)} />
              {f.label}
              {f.key === 'submitted' && ` (${(claims.data ?? []).filter((c) => c.status === 'submitted').length})`}
            </label>
          ))}
        </fieldset>
        {claims.isLoading && <Spinner />}
        {claims.error && <Alert variant="destructive" title="Couldn't load claims" role="alert">{(claims.error as Error).message}</Alert>}
        {claims.data && (
          <Card>
            <Table>
              <caption className="sr-only">Claims</caption>
              <THead>
                <TR>
                  <TH>Claim</TH>
                  <TH>Buyer</TH>
                  <TH>Shipment</TH>
                  <TH>Reported</TH>
                  <TH className="text-right">Claimed</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link to="/claims/$claimId" params={{ claimId: c.id }} className="font-semibold underline">
                        {c.claim_number}
                      </Link>
                    </TD>
                    <TD>{c.customers?.company_name}</TD>
                    <TD>{c.shipments?.shipment_ref}</TD>
                    <TD className="whitespace-nowrap">{formatDateTime(c.submitted_at)}</TD>
                    <TD className="text-right tabular-nums">{money(c.claim_lines.reduce((s, l) => s + l.claimed_amount, 0), c.currency)}</TD>
                    <TD>
                      <ClaimStatusBadge status={c.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {rows.length === 0 && <p className="p-4 text-muted-foreground">{filter === 'submitted' ? 'No claims to review.' : 'No claims.'}</p>}
          </Card>
        )}
      </div>
    </>
  )
}
