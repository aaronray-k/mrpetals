import * as React from 'react'
import { AlertTriangle, Banknote, Boxes, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { Order } from '~/lib/orders/api'
import { approveOrder, createPackingList, declineOrder, markOrderPaid, markOrderUnpaid, useBuyerCredit, type Coverage } from '~/lib/ordering/api'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { money } from '~/components/shop/money'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { useToast } from '~/components/ui/toaster'
import { ReasonDialog } from './reason-dialog'

export function OrderStatusBadge({ order }: { order: Order }) {
  switch (order.status) {
    case 'submitted':
      return <Badge variant="warning">Waiting for approval</Badge>
    case 'open':
      return <Badge variant="success">Approved</Badge>
    case 'declined':
      return <Badge variant="destructive">Declined</Badge>
    case 'cancelled':
      return <Badge variant="destructive">Cancelled</Badge>
  }
}

/**
 * What the order needs next: approval, payment, the credit check and the packing list. Each
 * button appears only for the roles that may use it.
 */
export function OrderActions({ order, coverage, hasBoxes, onChanged }: { order: Order; coverage: Coverage[]; hasBoxes: boolean; onChanged: () => void }) {
  const { roles } = useAuth()
  const toast = useToast()
  const credit = useBuyerCredit(order.customer_id)
  const [dialog, setDialog] = React.useState<null | 'decline' | 'paid'>(null)
  const [busy, setBusy] = React.useState(false)
  const staff = hasAnyRole(roles, STAFF_ROLES)
  const money_ = hasAnyRole(roles, ['admin', 'finance'])
  const stems = coverage.reduce((s, c) => s + c.stems, 0)
  const confirmed = coverage.reduce((s, c) => s + Math.min(c.confirmed, c.stems), 0)
  const short = coverage.filter((c) => c.short > 0)
  const allConfirmed = stems > 0 && confirmed >= stems
  const canDecline = !hasBoxes && (order.status === 'submitted' ? staff || money_ : order.status === 'open' && money_)

  async function run(title: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      toast({ kind: 'success', title })
      onChanged()
    } catch (e) {
      toast({ kind: 'error', title: 'Not done', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Next steps</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {order.status === 'declined' && (
          <p className="flex items-start gap-2 font-semibold text-destructive">
            <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> Declined: {order.decline_reason}
          </p>
        )}
        {order.flight_note && (
          <p className="flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {order.flight_note}
          </p>
        )}

        {credit.data && credit.data.is_prepaid && (
          <p className="flex items-start gap-2 text-sm">
            <Banknote className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Prepaid buyer: the shipment can't close until this order is marked paid.
          </p>
        )}
        {credit.data?.over_limit && (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-bg p-3 text-sm font-semibold" role="status">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Over the credit limit: {money(credit.data.open_value, credit.data.currency)} open against a limit of{' '}
            {money(credit.data.credit_limit ?? 0, credit.data.currency)}. Finance or Admin can decline this order.
          </p>
        )}

        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Payment:</span>
          {order.payment_status === 'paid' ? (
            <Badge variant="success">
              <CheckCircle2 aria-hidden="true" /> Paid{order.payment_reference ? ` (${order.payment_reference})` : ''}
            </Badge>
          ) : (
            <Badge>Not paid</Badge>
          )}
        </p>

        {order.status === 'open' && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Farms:</span>
            {allConfirmed ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="size-4" aria-hidden="true" /> every stem confirmed
              </span>
            ) : (
              <span>
                {confirmed.toLocaleString('en-GB')} of {stems.toLocaleString('en-GB')} stems confirmed
                {short.length > 0 && (
                  <strong className="text-warning">
                    {' '}
                    · {short.reduce((s, c) => s + c.short, 0).toLocaleString('en-GB')} stems still to place (line {short.map((c) => c.line_no).join(', ')})
                  </strong>
                )}
              </span>
            )}
            {order.packing_list_at && <Badge variant="success">Packing list ready</Badge>}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {order.status === 'submitted' && staff && (
            <Button disabled={busy} onClick={() => run(`${order.order_number} approved`, () => approveOrder(order.id))}>
              <CheckCircle2 aria-hidden="true" /> Approve order
            </Button>
          )}
          {order.status === 'open' && staff && !order.packing_list_at && (
            <Button disabled={busy || !allConfirmed || !order.shipment_id} onClick={() => run('Packing list created', () => createPackingList(order.id))}>
              <Boxes aria-hidden="true" /> Create packing list
            </Button>
          )}
          {money_ && order.status === 'open' && order.payment_status === 'unpaid' && (
            <Button variant="outline" disabled={busy} onClick={() => setDialog('paid')}>
              <Banknote aria-hidden="true" /> Mark paid…
            </Button>
          )}
          {money_ && order.payment_status === 'paid' && (
            <Button variant="ghost" disabled={busy} onClick={() => run('Marked not paid', () => markOrderUnpaid(order.id))}>
              Mark not paid
            </Button>
          )}
          {canDecline && (
            <Button variant="outline" disabled={busy} onClick={() => setDialog('decline')}>
              <XCircle aria-hidden="true" /> Decline order…
            </Button>
          )}
        </div>
        {order.status === 'open' && staff && !order.packing_list_at && !allConfirmed && (
          <p className="text-sm text-muted-foreground">The packing list can be created once every stem is confirmed by a farm.</p>
        )}
        {order.status === 'open' && staff && !order.packing_list_at && allConfirmed && !order.shipment_id && (
          <p className="text-sm text-muted-foreground">Choose the order's shipment first.</p>
        )}
      </CardContent>

      <ReasonDialog
        open={dialog === 'decline'}
        onClose={() => setDialog(null)}
        title={`Decline ${order.order_number}`}
        description="The buyer is told, with your reason. Any farm POs are cancelled."
        label="Why is it declined?"
        confirmLabel="Decline order"
        destructive
        onConfirm={async (reason) => {
          await declineOrder(order.id, reason)
          toast({ kind: 'success', title: `${order.order_number} declined` })
          onChanged()
        }}
      />
      <ReasonDialog
        open={dialog === 'paid'}
        onClose={() => setDialog(null)}
        title={`Mark ${order.order_number} paid`}
        label="Payment reference (bank transfer, receipt…)"
        confirmLabel="Mark paid"
        onConfirm={async (reference) => {
          await markOrderPaid(order.id, reference)
          toast({ kind: 'success', title: `${order.order_number} marked paid` })
          onChanged()
        }}
      />
    </Card>
  )
}
