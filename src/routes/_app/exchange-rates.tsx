import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { useAuth } from '~/lib/auth'
import { hasAnyRole } from '~/lib/roles'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { formatDate } from '~/components/orders/shipment-status'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/exchange-rates')({
  head: () => ({ meta: [{ title: 'Exchange rates · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/exchange-rates')}>
      <RatesPage />
    </RequireRole>
  ),
})

interface Rate {
  id: string
  from_currency: string
  to_currency: string
  rate: number
  valid_from: string
}

const CURRENCIES = ['USD', 'EUR', 'KES', 'GBP', 'JPY']

function RatesPage() {
  const { roles } = useAuth()
  const canEdit = hasAnyRole(roles, ['admin', 'finance'])
  const toast = useToast()
  const queryClient = useQueryClient()
  const q = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('exchange_rates').select('*').order('from_currency').order('to_currency').order('valid_from', { ascending: false })
      if (error) throw new Error(error.message)
      return (data as Rate[]).map((r) => ({ ...r, rate: Number(r.rate) }))
    },
  })
  const [from, setFrom] = React.useState('USD')
  const [to, setTo] = React.useState('EUR')
  const [rate, setRate] = React.useState('')
  const [validFrom, setValidFrom] = React.useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = React.useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const r = Number(rate)
    if (from === to) return setError('Choose two different currencies.')
    if (!Number.isFinite(r) || r <= 0) return setError('Enter the rate, e.g. 0.92 (1 USD = 0.92 EUR).')
    setError(null)
    const { error } = await getSupabase().from('exchange_rates').upsert({ from_currency: from, to_currency: to, rate: r, valid_from: validFrom }, { onConflict: 'from_currency,to_currency,valid_from' })
    if (error) return setError(error.message)
    toast({ kind: 'success', title: `1 ${from} = ${r} ${to} saved`, description: 'Catalog prices for buyers in that currency follow at once; placed orders keep their prices.' })
    setRate('')
    void queryClient.invalidateQueries({ queryKey: ['exchange-rates'] })
  }

  // The latest rate per currency pair is the one in use.
  const current = new Set<string>()
  return (
    <>
      <PageHeader title="Exchange rates" description="Farm prices and margins are converted into each buyer's currency with these rates." />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="rates.how" title="How rates are used">
          Enter one direction (for example 1 USD = 0.92 EUR); the reverse is worked out. The newest rate from its start date is used for new
          prices. Orders already placed keep the price the buyer was quoted.
        </Tip>
        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Add a rate</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={save} noValidate className="grid gap-3 sm:grid-cols-[8rem_8rem_10rem_12rem_auto] sm:items-end">
                <Field id="r-from" label="From">
                  {(d) => (
                    <Select id="r-from" value={from} onChange={(e) => setFrom(e.target.value)} aria-describedby={d}>
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="r-to" label="To">
                  {(d) => (
                    <Select id="r-to" value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={d}>
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="r-rate" label={`1 ${from} =`}>
                  {(d) => <Input id="r-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={`… ${to}`} aria-describedby={d} />}
                </Field>
                <Field id="r-from-date" label="From date">
                  {(d) => <Input id="r-from-date" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} aria-describedby={d} />}
                </Field>
                <Button type="submit">Save rate</Button>
                {error && (
                  <p className="text-sm font-semibold text-destructive sm:col-span-5" role="alert">
                    {error}
                  </p>
                )}
              </form>
            </CardContent>
          </Card>
        )}
        {q.isLoading && <Spinner />}
        {q.error && <Alert variant="destructive" title="Couldn't load rates" role="alert">{(q.error as Error).message}</Alert>}
        {q.data && (
          <div className="rounded-lg border bg-card">
            <Table>
              <caption className="sr-only">Exchange rates</caption>
              <THead>
                <TR>
                  <TH>Rate</TH>
                  <TH>From date</TH>
                  <TH>In use</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.map((r) => {
                  const pair = `${r.from_currency}-${r.to_currency}`
                  const inUse = !current.has(pair) && r.valid_from <= new Date().toISOString().slice(0, 10)
                  if (inUse) current.add(pair)
                  return (
                    <TR key={r.id}>
                      <TD className="tabular-nums">
                        1 {r.from_currency} = {r.rate} {r.to_currency}
                      </TD>
                      <TD>{formatDate(r.valid_from)}</TD>
                      <TD>{inUse ? 'Yes' : ''}</TD>
                    </TR>
                  )
                })}
                {q.data.length === 0 && (
                  <TR>
                    <TD colSpan={3} className="text-muted-foreground">
                      No rates yet. Buyers paying in another currency than the farm prices see no prices until one is added.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </>
  )
}
