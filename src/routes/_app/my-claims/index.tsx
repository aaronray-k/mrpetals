import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useClaims } from '~/lib/claims/api'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { ClaimStatusBadge } from '~/components/claims/claim-parts'
import { money } from '~/components/shop/money'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { buttonVariants } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export const Route = createFileRoute('/_app/my-claims/')({
  head: () => ({ meta: [{ title: 'My claims · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/my-claims')}>
      <MyClaims />
    </RequireRole>
  ),
})

function MyClaims() {
  const claims = useClaims()
  return (
    <>
      <PageHeader
        title="My claims"
        description="Problems with flowers you received, and what ConsolFlora decided."
        actions={
          <Link to="/my-claims/new" className={buttonVariants()}>
            <Plus aria-hidden="true" /> Report a problem
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="claims.how" title="How claims work">
          Report a problem within the claim window after your flight lands: choose the boxes, say what's wrong and add photos. ConsolFlora
          reviews each box and you get a credit note for what is approved. See the{' '}
          <Link to="/legal/$code" params={{ code: 'claims' }} className="font-semibold underline">
            Claims and credits policy
          </Link>
          .
        </Tip>
        {claims.isLoading && <Spinner />}
        {claims.error && <Alert variant="destructive" title="Couldn't load your claims" role="alert">{(claims.error as Error).message}</Alert>}
        {claims.data?.length === 0 && <p className="text-muted-foreground">No claims yet.</p>}
        {!!claims.data?.length && (
          <Card>
            <Table>
              <caption className="sr-only">Your claims</caption>
              <THead>
                <TR>
                  <TH>Claim</TH>
                  <TH>Shipment</TH>
                  <TH>Reported</TH>
                  <TH className="text-right">Claimed</TH>
                  <TH>Status</TH>
                  <TH>Credit note</TH>
                </TR>
              </THead>
              <TBody>
                {claims.data.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link to="/my-claims/$claimId" params={{ claimId: c.id }} className="font-semibold underline">
                        {c.claim_number}
                      </Link>
                    </TD>
                    <TD>{c.shipments?.shipment_ref}</TD>
                    <TD className="whitespace-nowrap">{formatDateTime(c.submitted_at)}</TD>
                    <TD className="text-right tabular-nums">{money(c.claim_lines.reduce((s, l) => s + l.claimed_amount, 0), c.currency)}</TD>
                    <TD>
                      <ClaimStatusBadge status={c.status} />
                    </TD>
                    <TD>{c.credit_notes[0] ? `${c.credit_notes[0].credit_note_number} · ${money(c.credit_notes[0].amount, c.currency)}` : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  )
}
