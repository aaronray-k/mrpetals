import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, FilePlus2, Search } from 'lucide-react'
import { useOdooMoves, type MovesQuery } from '~/lib/odoo/api'
import { cn } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { MOVE_LABEL, day } from '~/components/odoo/invoice-preview'
import { MoveStatus } from '~/components/odoo/invoice-status'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export const Route = createFileRoute('/_app/odoo-invoices/')({
  head: () => ({ meta: [{ title: 'All invoices in Odoo · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/odoo-invoices')}>
      <OdooInvoicesPage />
    </RequireRole>
  ),
})

const SIDES = [
  { key: 'out', label: 'Sent to buyers', who: 'Buyer' },
  { key: 'in', label: 'Received from growers', who: 'Grower or supplier' },
] as const

function OdooInvoicesPage() {
  const [side, setSide] = React.useState<'out' | 'in'>('out')
  const [partner, setPartner] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [state, setState] = React.useState<MovesQuery['state']>('all')
  const [payment, setPayment] = React.useState<MovesQuery['payment']>('all')
  const [q, setQ] = React.useState<MovesQuery>({ side, partner: null, search: null, from: null, to: null, state, payment, offset: 0 })
  const moves = useOdooMoves(q)
  const list = moves.data?.list
  const who = SIDES.find((x) => x.key === q.side)!.who

  const apply = (next: Partial<MovesQuery> = {}) =>
    setQ({ side, partner: partner.trim() || null, search: search.trim() || null, from: from || null, to: to || null, state, payment, offset: 0, ...next })

  return (
    <>
      <PageHeader
        title="All invoices in Odoo"
        description="Everything in Odoo: invoices and credit notes sent to buyers, and bills and refunds received from growers, including ones made in Odoo itself."
        actions={
          <Link to="/invoices/new" className={buttonVariants()}>
            <FilePlus2 aria-hidden="true" /> New invoice
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <fieldset className="flex w-fit flex-wrap gap-1 rounded-md border border-input bg-card p-1">
          <legend className="sr-only">Show</legend>
          {SIDES.map((x) => (
            <label key={x.key} className={cn('inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', side === x.key && 'bg-accent/20')}>
              <input
                type="radio"
                name="odoo-side"
                className="sr-only"
                checked={side === x.key}
                onChange={() => {
                  setSide(x.key)
                  setPartner('')
                  apply({ side: x.key, partner: null })
                }}
              />
              {x.label}
            </label>
          ))}
        </fieldset>
        <Card>
          <CardContent className="pt-6">
            <form
              noValidate
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault()
                apply()
              }}
            >
              <Field id="om-partner" label={side === 'out' ? 'Buyer' : 'Grower or supplier'} hint="Part of the name. Empty: all.">
                {(d) => <Input id="om-partner" type="search" value={partner} onChange={(e) => setPartner(e.target.value)} aria-describedby={d} />}
              </Field>
              <Field id="om-search" label="Number or reference" hint="e.g. INV/2026/00012, BILL/2026/0045 or the supplier's invoice number.">
                {(d) => <Input id="om-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-describedby={d} />}
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field id="om-from" label="From">
                  {(d) => <Input id="om-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-describedby={d} />}
                </Field>
                <Field id="om-to" label="To">
                  {(d) => <Input id="om-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={d} />}
                </Field>
              </div>
              <Field id="om-state" label="Status">
                {(d) => (
                  <Select id="om-state" value={state} onChange={(e) => setState(e.target.value as MovesQuery['state'])} aria-describedby={d}>
                    <option value="all">All</option>
                    <option value="draft">Drafts</option>
                    <option value="posted">Confirmed</option>
                    <option value="cancel">Cancelled</option>
                  </Select>
                )}
              </Field>
              <Field id="om-payment" label="Payment">
                {(d) => (
                  <Select id="om-payment" value={payment} onChange={(e) => setPayment(e.target.value as MovesQuery['payment'])} aria-describedby={d}>
                    <option value="all">All</option>
                    <option value="unpaid">Not paid (or part paid)</option>
                    <option value="paid">Paid</option>
                  </Select>
                )}
              </Field>
              <div className="flex items-end">
                <Button type="submit">
                  <Search aria-hidden="true" /> Search Odoo
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {moves.isFetching && <Spinner />}
        {moves.error && <Alert variant="destructive" title="Couldn't read Odoo" role="alert">{(moves.error as Error).message}</Alert>}
        {moves.data?.error && (
          <Alert variant="warning" title="Couldn't read Odoo">
            {moves.data.error} <Link to="/settings/odoo" className="font-semibold underline">Odoo settings</Link>
          </Alert>
        )}
        {moves.data?.source === 'demo' && <p className="text-sm text-muted-foreground">Preview: these are from the demo Odoo, not your books.</p>}

        {list && !moves.isFetching && (
          <>
            <p className="text-sm">
              {list.total} {list.total === 1 ? 'document' : 'documents'}
              {list.due.length > 0 && (
                <>
                  {' · '}still due: <strong>{list.due.map((d) => money(d.amount, d.currency)).join(' + ')}</strong>
                </>
              )}
            </p>
            <Card>
              <Table>
                <caption className="sr-only">{SIDES.find((x) => x.key === q.side)!.label}</caption>
                <THead>
                  <TR>
                    <TH>Number</TH>
                    <TH>{who}</TH>
                    <TH>Date</TH>
                    <TH>Due</TH>
                    <TH>Reference</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Still due</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {list.moves.map((m) => {
                    const ours = list.ours[m.move_id]
                    const label = m.state === 'draft' && (m.name === '/' || !m.name) ? `Draft ${MOVE_LABEL[m.move_type]?.toLowerCase() ?? ''}` : m.name
                    return (
                      <TR key={m.move_id}>
                        <TD className="whitespace-nowrap">
                          {ours ? (
                            <Link to="/invoices/$invoiceId" params={{ invoiceId: ours }} className="font-semibold underline underline-offset-2">
                              {label}
                            </Link>
                          ) : (
                            <Link to="/odoo-invoices/$moveId" params={{ moveId: String(m.move_id) }} className="font-semibold underline underline-offset-2">
                              {label}
                            </Link>
                          )}
                          <span className="block text-sm text-muted-foreground">
                            {MOVE_LABEL[m.move_type]}
                            {ours && ' · ConsolFlora'}
                          </span>
                        </TD>
                        <TD>{m.partner}</TD>
                        <TD className="whitespace-nowrap">{day(m.date)}</TD>
                        <TD className="whitespace-nowrap">{day(m.due_date)}</TD>
                        <TD className="min-w-32">{m.reference}</TD>
                        <TD className="text-right tabular-nums">{money(m.move_type.endsWith('refund') ? -m.amount_total : m.amount_total, m.currency)}</TD>
                        <TD className="text-right tabular-nums">{m.state === 'posted' ? money(m.amount_due, m.currency) : '—'}</TD>
                        <TD>
                          <MoveStatus m={m} />
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
              {list.moves.length === 0 && <p className="p-4 text-muted-foreground">Nothing in Odoo for these filters.</p>}
            </Card>
            {list.total > 50 && (
              <nav aria-label="Pages" className="flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled={q.offset === 0} onClick={() => setQ({ ...q, offset: Math.max(0, q.offset - 50) })}>
                  <ChevronLeft aria-hidden="true" /> Newer
                </Button>
                <span className="text-sm">
                  {q.offset + 1}–{Math.min(q.offset + 50, list.total)} of {list.total}
                </span>
                <Button variant="outline" disabled={q.offset + 50 >= list.total} onClick={() => setQ({ ...q, offset: q.offset + 50 })}>
                  Older <ChevronRight aria-hidden="true" />
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  )
}
