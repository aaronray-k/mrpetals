import * as React from 'react'
import { Link, Navigate, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, ExternalLink, RotateCcw } from 'lucide-react'
import { makePdfInOdoo, odooMovePdf, runOdooMoveAction, useOdooMove } from '~/lib/odoo/api'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { InvoicePreview, MOVE_LABEL, day } from '~/components/odoo/invoice-preview'
import { MoveStatus } from '~/components/odoo/invoice-status'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/odoo-invoices/$moveId')({
  head: () => ({ meta: [{ title: 'Odoo invoice · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/odoo-invoices')}>
      <OdooMovePage />
    </RequireRole>
  ),
})

/** An invoice, credit note, bill or refund made in Odoo itself: the preview, and Confirm or Reset to draft. */
function OdooMovePage() {
  const { moveId } = Route.useParams()
  const id = Number(moveId)
  const move = useOdooMove(id)
  const toast = useToast()
  const queryClient = useQueryClient()
  const [asking, setAsking] = React.useState<'confirm' | 'reset' | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function act(action: 'confirm' | 'reset') {
    setAsking(null)
    setBusy(true)
    try {
      const r = await runOdooMoveAction(id, action)
      if (r.ok)
        toast({
          kind: 'success',
          title: action === 'confirm' ? `Confirmed as ${r.move.name}` : 'Back to draft in Odoo',
          description: r.pdf ? (r.pdf.ok ? "Odoo's PDF is ready." : `No PDF yet: ${r.pdf.message}`) : undefined,
        })
      else toast({ kind: 'error', title: 'Odoo said no', description: r.message })
    } catch (e) {
      toast({ kind: 'error', title: 'Not done', description: (e as Error).message })
    } finally {
      setBusy(false)
      for (const k of ['odoo-move', 'odoo-moves', 'odoo-log']) void queryClient.invalidateQueries({ queryKey: [k] })
    }
  }

  if (!Number.isInteger(id) || id <= 0) return <Alert variant="destructive" title="This isn't an Odoo invoice number." />
  if (move.isLoading) return <Spinner />
  // Made by ConsolFlora: its own page has ConsolFlora's details too.
  if (move.data?.invoiceId) return <Navigate to="/invoices/$invoiceId" params={{ invoiceId: move.data.invoiceId }} replace />
  const d = move.data?.detail ?? null
  const kind = d ? (MOVE_LABEL[d.move_type] ?? 'Invoice') : 'Invoice'
  const incoming = d?.move_type.startsWith('in_') ?? false

  return (
    <>
      <PageHeader
        title={d ? (d.state === 'draft' && (d.name === '/' || !d.name) ? `Draft ${kind.toLowerCase()}` : d.name) : 'Odoo invoice'}
        description={d ? `${kind} · ${d.partner ?? ''}${d.reference ? ` · ${d.reference}` : ''}` : undefined}
        actions={
          <Link to="/odoo-invoices" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" /> All invoices in Odoo
          </Link>
        }
      />
      {move.error && <Alert variant="destructive" title="Couldn't read Odoo" role="alert">{(move.error as Error).message}</Alert>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="content-start">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>In Odoo</CardTitle>
              {d && <MoveStatus m={d} />}
            </div>
            <CardDescription>
              {incoming ? 'Received from a grower or supplier; made in Odoo.' : 'Made in Odoo, not by ConsolFlora.'}{' '}
              {d?.state === 'draft' ? 'A draft: check it against the preview, then confirm it.' : d?.state === 'posted' ? 'Confirmed. To change it, reset it to draft (Odoo refuses once it is paid).' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {d && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{incoming ? 'From' : 'To'}</dt>
                <dd>{d.partner}</dd>
                <dt className="text-muted-foreground">Date</dt>
                <dd>{day(d.invoice_date)}</dd>
                <dt className="text-muted-foreground">Due</dt>
                <dd>{day(d.due_date)}</dd>
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-semibold tabular-nums">{d.currency ? money(d.amount_total, d.currency) : d.amount_total}</dd>
                {d.state === 'posted' && (
                  <>
                    <dt className="text-muted-foreground">Still due</dt>
                    <dd className="tabular-nums">{d.currency ? money(d.amount_due, d.currency) : d.amount_due}</dd>
                  </>
                )}
              </dl>
            )}
            <div className="flex flex-wrap gap-2">
              {d?.state === 'draft' && (
                <Button disabled={busy} onClick={() => setAsking('confirm')}>
                  <CheckCircle2 aria-hidden="true" /> {busy ? 'Confirming…' : `Confirm ${kind.toLowerCase()}`}
                </Button>
              )}
              {d?.state === 'posted' && (
                <Button variant="outline" disabled={busy} onClick={() => setAsking('reset')}>
                  <RotateCcw aria-hidden="true" /> {busy ? 'Resetting…' : 'Reset to draft'}
                </Button>
              )}
              {d && move.data?.source !== 'demo' && (
                <a href={d.url} target="_blank" rel="noopener" className={buttonVariants({ variant: 'outline' })}>
                  <ExternalLink aria-hidden="true" /> Open in Odoo<span className="sr-only"> (new tab)</span>
                </a>
              )}
            </div>
          </CardContent>
        </Card>
        <InvoicePreview loadPdf={() => odooMovePdf(id)} makePdf={() => makePdfInOdoo({ moveId: id })} onPdfMade={() => void queryClient.invalidateQueries({ queryKey: ['odoo-move'] })} loading={move.isFetching && !d} detail={d} reason={move.data?.error ?? null} currency={d?.currency ?? 'USD'} credit={d?.move_type.endsWith('refund') ?? false} />
      </div>
      <Dialog
        open={asking === 'confirm'}
        onClose={() => setAsking(null)}
        title={`Confirm this ${kind.toLowerCase()}?`}
        description={d ? `${d.partner}, ${d.currency ? money(d.amount_total, d.currency) : d.amount_total}. Odoo gives it its number.` : undefined}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button onClick={() => void act('confirm')}>Confirm</Button>
        </div>
      </Dialog>
      <Dialog open={asking === 'reset'} onClose={() => setAsking(null)} title="Reset to draft?" description={`${d?.name ?? ''} goes back to draft in Odoo so it can be changed there.`}>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button onClick={() => void act('reset')}>Reset to draft</Button>
        </div>
      </Dialog>
    </>
  )
}
