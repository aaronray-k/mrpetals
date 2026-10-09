import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Search } from 'lucide-react'
import { getLedger } from '~/server/odoo.functions'
import type { LedgerSide } from '~/server/odoo/client'
import { KIND_LABEL, SIDE_LABEL, buildStatement, filtersLabel, type Statement, type StatementAccount, type StatementFilters } from '~/lib/statements/statement'
import { cn } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/statements')({
  head: () => ({ meta: [{ title: 'Statements of account · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/statements')}>
      <StatementsPage />
    </RequireRole>
  ),
})

const today = () => new Date().toISOString().slice(0, 10)
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')
type OdooQuery = Omit<StatementFilters, 'number'>

function StatementsPage() {
  const toast = useToast()
  const [side, setSide] = React.useState<LedgerSide>('supplier')
  const [partner, setPartner] = React.useState('')
  const [from, setFrom] = React.useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = React.useState(today())
  const [drafts, setDrafts] = React.useState(false)
  // The number search filters what is already loaded, as you type; the rest asks Odoo again on Show.
  const [number, setNumber] = React.useState('')
  const [asked, setAsked] = React.useState<OdooQuery>({ side, from, to, partner: null, drafts })
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'pdf' | 'xlsx' | null>(null)

  const ledger = useQuery({
    queryKey: ['ledger', asked],
    queryFn: () => getLedger({ data: { side: asked.side, from: asked.from, to: asked.to, partner: asked.partner, drafts: asked.drafts } }),
    staleTime: 60_000,
  })
  const statement: Statement | null = React.useMemo(
    () => (ledger.data?.ledger ? buildStatement(ledger.data.ledger, { ...asked, number: number.trim() || null }) : null),
    [ledger.data, asked, number],
  )

  function show(next: Partial<OdooQuery> = {}) {
    const q = { side, from: from || null, to, partner: partner.trim() || null, drafts, ...next }
    if (!q.to) return setError('Choose the end date.')
    if (q.from && q.from > q.to) return setError('The start date is after the end date.')
    setError(null)
    setAsked(q)
  }
  async function download(kind: 'pdf' | 'xlsx') {
    if (!statement) return
    setBusy(kind)
    try {
      if (kind === 'pdf') await (await import('~/lib/statements/pdf')).downloadStatementPdf(statement)
      else await (await import('~/lib/statements/excel')).downloadStatementExcel(statement)
    } catch (e) {
      toast({ kind: 'error', title: 'Not downloaded', description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const labels = SIDE_LABEL[asked.side]
  return (
    <>
      <PageHeader
        title="Statements of account"
        description="Cumulative balances from Odoo for each supplier or buyer, one account per currency, with every bill, invoice, payment and credit."
        actions={
          <>
            <Button variant="outline" disabled={!statement?.accounts.length || !!busy} onClick={() => void download('pdf')}>
              <Download aria-hidden="true" /> {busy === 'pdf' ? 'Making PDF…' : 'PDF'}
            </Button>
            <Button variant="outline" disabled={!statement?.accounts.length || !!busy} onClick={() => void download('xlsx')}>
              <FileSpreadsheet aria-hidden="true" /> {busy === 'xlsx' ? 'Making Excel…' : 'Excel'}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardContent className="pt-6">
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                show()
              }}
              className="grid gap-4"
            >
              <fieldset className="flex w-fit flex-wrap gap-1 rounded-md border border-input bg-card p-1">
                <legend className="sr-only">Statements for</legend>
                {(['supplier', 'buyer'] as const).map((s) => (
                  <label key={s} className={cn('inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', side === s && 'bg-accent/20')}>
                    <input
                      type="radio"
                      name="statement-side"
                      className="sr-only"
                      checked={side === s}
                      onChange={() => {
                        // A supplier's name won't match a buyer: start the other side unfiltered.
                        setSide(s)
                        setPartner('')
                        show({ side: s, partner: null })
                      }}
                    />
                    {s === 'supplier' ? 'Suppliers (vendor bills)' : 'Buyers (customer invoices)'}
                  </label>
                ))}
              </fieldset>
              {error && <Alert variant="destructive" title={error} role="alert" />}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field id="st-partner" label={side === 'supplier' ? 'Supplier' : 'Buyer'} hint="Part of the name, e.g. Fontana. Empty: all.">
                  {(d) => <Input id="st-partner" type="search" value={partner} onChange={(e) => setPartner(e.target.value)} aria-describedby={d} />}
                </Field>
                <Field id="st-from" label="From" hint="Earlier lines make the balance brought forward. Empty: from the start.">
                  {(d) => <Input id="st-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-describedby={d} />}
                </Field>
                <Field id="st-to" label="To">
                  {(d) => <Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={d} />}
                </Field>
                <Field id="st-number" label={side === 'buyer' ? 'Number, reference or MAWB' : 'Number or reference'} hint={side === 'buyer' ? 'Invoice or payment number, reference or MAWB. Filters as you type.' : 'Bill, invoice or payment number, or reference. Filters as you type.'}>
                  {(d) => <Input id="st-number" type="search" value={number} onChange={(e) => setNumber(e.target.value)} aria-describedby={d} />}
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Switch checked={drafts} onCheckedChange={setDrafts} label="Include drafts" />
                <Button type="submit">
                  <Search aria-hidden="true" /> Show statements
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {ledger.isFetching && <Spinner />}
        {ledger.error && <Alert variant="destructive" title="Couldn't read Odoo" role="alert">{(ledger.error as Error).message}</Alert>}
        {ledger.data?.error && (
          <Alert variant="warning" title="Couldn't read Odoo">
            {ledger.data.error} <Link to="/settings/odoo" className="font-semibold underline">Odoo settings</Link>
          </Alert>
        )}
        {ledger.data?.source === 'demo' && <p className="text-sm text-muted-foreground">Preview: these are from the demo Odoo, not your books.</p>}

        {statement && !ledger.isFetching && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{labels.title}</CardTitle>
                <CardDescription>
                  {filtersLabel(statement.filters)}. Balance: {labels.balance.toLowerCase()}. Currencies are never added together.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {statement.totals.length ? (
                  <Table>
                    <caption className="sr-only">Totals per currency</caption>
                    <THead>
                      <TR>
                        <TH>Currency</TH>
                        <TH className="text-right">Accounts</TH>
                        <TH className="text-right">Brought forward</TH>
                        <TH className="text-right">{asked.side === 'supplier' ? 'Bills' : 'Invoices'}</TH>
                        <TH className="text-right">Paid / credited</TH>
                        <TH className="text-right">Balance</TH>
                        <TH className="text-right">Overdue</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {statement.totals.map((t) => (
                        <TR key={t.currency}>
                          <TD className="font-semibold">{t.currency}</TD>
                          <TD className="text-right tabular-nums">{t.accounts}</TD>
                          <TD className="text-right tabular-nums">{money(t.opening, t.currency)}</TD>
                          <TD className="text-right tabular-nums">{money(t.charges, t.currency)}</TD>
                          <TD className="text-right tabular-nums">{money(t.credits, t.currency)}</TD>
                          <TD className="text-right font-semibold tabular-nums">{money(t.closing, t.currency)}</TD>
                          <TD className="text-right tabular-nums">{money(t.overdue, t.currency)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground">Nothing for these filters.</p>
                )}
              </CardContent>
            </Card>
            {statement.accounts.map((a) => (
              <AccountCard key={a.key} a={a} side={asked.side} from={asked.from} open={statement.accounts.length <= 6} />
            ))}
          </>
        )}
      </div>
    </>
  )
}

function AccountCard({ a, side, from, open }: { a: StatementAccount; side: LedgerSide; from: string | null; open: boolean }) {
  return (
    <Card>
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6">
          <span className="text-lg font-semibold">
            <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open:rotate-90">
              ›
            </span>
            {a.title}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {a.overdue > 0 && <Badge variant="warning">Overdue {money(a.overdue, a.currency)}</Badge>}
            <span className="font-semibold tabular-nums">
              {SIDE_LABEL[side].balance}: {money(a.closing, a.currency)}
            </span>
          </span>
        </summary>
        <div className="overflow-x-auto px-2 pb-4 sm:px-4">
          <Table>
            <caption className="sr-only">Statement of account: {a.title}</caption>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>{side === 'supplier' ? 'Bill no.' : 'Invoice no.'}</TH>
                {side === 'buyer' && <TH>MAWB</TH>}
                <TH>Reference</TH>
                <TH>Due date</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Paid / credited</TH>
                <TH className="text-right">Balance</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="whitespace-nowrap">{day(from)}</TD>
                <TD colSpan={side === 'buyer' ? 7 : 6} className="text-muted-foreground">
                  Balance brought forward
                </TD>
                <TD className="text-right tabular-nums">{money(a.opening, a.currency)}</TD>
              </TR>
              {a.rows.map((r, i) => (
                <TR key={`${r.number}-${i}`}>
                  <TD className="whitespace-nowrap">{day(r.date)}</TD>
                  <TD className="whitespace-nowrap">
                    {KIND_LABEL[r.kind]} {r.draft && <Badge variant="warning">Draft</Badge>}
                  </TD>
                  <TD className="whitespace-nowrap">{r.number}</TD>
                  {side === 'buyer' && <TD className="whitespace-nowrap">{r.mawb}</TD>}
                  <TD className="min-w-40">{r.reference}</TD>
                  <TD className="whitespace-nowrap">{day(r.due_date)}</TD>
                  <TD className="text-right tabular-nums">{r.charge ? money(r.charge, a.currency) : ''}</TD>
                  <TD className="text-right tabular-nums">{r.credit ? money(r.credit, a.currency) : ''}</TD>
                  <TD className="text-right tabular-nums">{money(r.balance, a.currency)}</TD>
                </TR>
              ))}
              <TR className="font-semibold">
                <TD colSpan={side === 'buyer' ? 6 : 5}>Closing balance</TD>
                <TD className="text-right tabular-nums">{money(a.charges, a.currency)}</TD>
                <TD className="text-right tabular-nums">{money(a.credits, a.currency)}</TD>
                <TD className="text-right tabular-nums">{money(a.closing, a.currency)}</TD>
              </TR>
            </TBody>
          </Table>
        </div>
      </details>
    </Card>
  )
}
