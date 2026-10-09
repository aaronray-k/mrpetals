import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { SERVICES, SERVICE_LABELS, setCustomerService, type Service } from '~/lib/fees/api'
import { importBuyersFromOdoo, saveBuyerDetails, setBuyerOdooTerm, useBuyerLists, useOdooPaymentTerms, type BuyerDetails } from '~/lib/odoo/api'
import { DataList } from '~/components/data-list'
import { rolesFor } from '~/components/layout/nav'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Field, Input, Select } from '~/components/ui/input'
import { useToast } from '~/components/ui/toaster'

const money = (currency: unknown, value: unknown) =>
  value == null ? 'No credit' : `${currency} ${Number(value).toLocaleString('en-GB')}`

export const Route = createFileRoute('/_app/customers')({
  head: () => ({ meta: [{ title: 'Customers · ConsolFlora' }] }),
  component: () => (
    <DataList
      roles={rolesFor('/customers')}
      title="Customers"
      description="Buyers, their service, delivery terms and credit limits."
      tip={<ImportFromOdoo />}
      table="customers"
      select="id, customer_code, company_name, country, city, contact_name, contact_email, source, needs_details, currency, incoterm, payment_terms, odoo_payment_term_id, odoo_payment_term_name, credit_limit, destination_airport, service, active"
      orderBy="customer_code"
      searchKeys={['customer_code', 'company_name', 'city', 'contact_name']}
      columns={[
        { key: 'customer_code', header: 'Code', className: 'font-semibold' },
        {
          key: 'company_name',
          header: 'Company',
          render: (r) => (
            <span className="flex flex-wrap items-center gap-2">
              {String(r.company_name)}
              {r.source === 'odoo' && <Badge variant="outline">From Odoo</Badge>}
              {r.source === 'demo' && <Badge>Demo</Badge>}
              {r.needs_details === true && <DetailsButton row={r} />}
            </span>
          ),
        },
        { key: 'country', header: 'Country' },
        { key: 'destination_airport', header: 'Airport', render: (r) => (r.destination_airport as string | null) ?? '—' },
        { key: 'incoterm', header: 'Incoterm' },
        { key: 'service', header: 'Service', render: (r) => <ServicePicker customerId={r.id} name={String(r.company_name)} service={r.service as Service} /> },
        { key: 'payment_terms', header: 'Terms' },
        {
          key: 'odoo_payment_term_id',
          header: 'Odoo payment term',
          render: (r) => <OdooTermPicker customerId={r.id} name={String(r.company_name)} termId={(r.odoo_payment_term_id as number | null) ?? null} termName={(r.odoo_payment_term_name as string | null) ?? null} />,
        },
        { key: 'credit_limit', header: 'Credit limit', render: (r) => money(r.currency, r.credit_limit) },
      ]}
    />
  ),
})

/** Which ConsolFlora service the buyer takes; it decides the fees (see Fees and margins). */
function ServicePicker({ customerId, name, service }: { customerId: string; name: string; service: Service }) {
  const { roles } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [value, setValue] = React.useState(service)
  if (!hasAnyRole(roles, STAFF_ROLES)) return SERVICE_LABELS[service] ?? service
  return (
    <>
      <label className="sr-only" htmlFor={`svc-${customerId}`}>
        Service for {name}
      </label>
      <Select
        id={`svc-${customerId}`}
        value={value}
        className="min-w-44"
        onChange={async (e) => {
          const next = e.target.value as Service
          setValue(next)
          try {
            await setCustomerService(customerId, next)
            toast({ kind: 'success', title: `${name}: ${SERVICE_LABELS[next]}`, description: 'New orders use this service\'s fees.' })
            void queryClient.invalidateQueries({ queryKey: ['list', 'customers'] })
          } catch (err) {
            setValue(service)
            toast({ kind: 'error', title: 'Not changed', description: (err as Error).message })
          }
        }}
      >
        {SERVICES.map((s) => (
          <option key={s} value={s}>
            {SERVICE_LABELS[s]}
          </option>
        ))}
      </Select>
    </>
  )
}

/**
 * The buyer's payment term as Odoo has it, from Odoo's own list. It goes on the buyer's invoices, so Odoo works out
 * the due date when an invoice is confirmed. "From the terms column" keeps ConsolFlora's rule (e.g. 15th of
 * following month) and the Odoo settings mapping.
 */
function OdooTermPicker({ customerId, name, termId, termName }: { customerId: string; name: string; termId: number | null; termName: string | null }) {
  const { roles } = useAuth()
  const canSet = hasAnyRole(roles, ['admin', 'consolidator', 'finance'])
  const terms = useOdooPaymentTerms(canSet)
  const toast = useToast()
  const queryClient = useQueryClient()
  const [value, setValue] = React.useState(termId ?? 0)
  if (!canSet) return termName ?? '—'
  const list = terms.data?.terms ?? []
  // A term kept from before that Odoo no longer lists still shows, so it isn't silently lost.
  const options = termId && !list.some((t) => t.id === termId) ? [{ id: termId, name: termName ?? `Odoo term #${termId}` }, ...list] : list
  return (
    <>
      <label className="sr-only" htmlFor={`term-${customerId}`}>
        Odoo payment term for {name}
      </label>
      <Select
        id={`term-${customerId}`}
        value={value}
        className="min-w-48"
        disabled={terms.isLoading || !!terms.data?.error}
        title={terms.data?.error ?? undefined}
        onChange={async (e) => {
          const id = Number(e.target.value)
          const term = options.find((t) => t.id === id) ?? null
          setValue(id)
          try {
            await setBuyerOdooTerm(customerId, term)
            toast({
              kind: 'success',
              title: `${name}: ${term ? term.name : 'terms column'}`,
              description: term ? 'New invoices to this buyer carry this Odoo payment term; Odoo works out the due date.' : 'Due dates follow the terms column again.',
            })
            void queryClient.invalidateQueries({ queryKey: ['list', 'customers'] })
          } catch (err) {
            setValue(termId ?? 0)
            toast({ kind: 'error', title: 'Not changed', description: (err as Error).message })
          }
        }}
      >
        <option value={0}>{terms.isLoading ? 'Loading Odoo…' : terms.data?.error ? 'Odoo not reachable' : 'From the terms column'}</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
    </>
  )
}

/** Buyers come from Odoo: links each buyer company in Odoo to its ConsolFlora buyer, or adds it. */
function ImportFromOdoo() {
  const { roles } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  if (!hasAnyRole(roles, STAFF_ROLES)) return null
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Buyers come from Odoo&apos;s customer list. A buyer already here is matched by its Odoo link, its code (Odoo&apos;s Reference) or its
          exact name; the rest are added on FOB and Prepaid, marked <strong>Needs details</strong> until you add the airport and contact. Demo
          buyers are hidden: tick Show inactive to see them.
        </p>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await importBuyersFromOdoo()
              toast({
                kind: 'success',
                title: `${r.found} buyer${r.found === 1 ? '' : 's'} in Odoo`,
                description: `${r.created} added, ${r.updated} already here and linked.`,
              })
              void queryClient.invalidateQueries({ queryKey: ['list', 'customers'] })
            } catch (err) {
              toast({ kind: 'error', title: 'Not imported', description: (err as Error).message })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Reading Odoo…' : 'Import buyers from Odoo'}
        </Button>
      </CardContent>
    </Card>
  )
}

/** What Odoo doesn't hold for a buyer: the ordering contact, country, destination airport, incoterm and currency. */
function DetailsButton({ row }: { row: Record<string, unknown> }) {
  const { roles } = useAuth()
  const [open, setOpen] = React.useState(false)
  if (!hasAnyRole(roles, STAFF_ROLES)) return <Badge variant="warning">Needs details</Badge>
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-full focus-visible:outline-2">
        <Badge variant="warning">Needs details</Badge>
        <span className="sr-only">: fill in {String(row.company_name)}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${String(row.company_name)}: details`} description="Odoo doesn't hold these. Orders need the airport and an ordering contact.">
        {open && <DetailsForm row={row} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  )
}

function DetailsForm({ row, onDone }: { row: Record<string, unknown>; onDone: () => void }) {
  const lists = useBuyerLists()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [d, setD] = React.useState<BuyerDetails>({
    contact_name: String(row.contact_name ?? ''),
    contact_email: String(row.contact_email ?? ''),
    country: String(row.country ?? ''),
    destination_airport: (row.destination_airport as string | null) ?? '',
    incoterm: String(row.incoterm ?? 'FOB'),
    currency: String(row.currency ?? 'USD'),
  })
  const [error, setError] = React.useState<string | null>(null)
  const id = String(row.id)
  const set = (k: keyof BuyerDetails) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value })
  const airport = (d.destination_airport ?? '').trim().toUpperCase()
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!/^[A-Z]{3}$/.test(airport)) return setError('The destination airport is three letters, e.g. NRT.')
        if (!d.contact_name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contact_email.trim()) || !d.country.trim()) return setError('Fill in the contact, a valid email and the country.')
        try {
          await saveBuyerDetails(id, { ...d, contact_name: d.contact_name.trim(), contact_email: d.contact_email.trim(), country: d.country.trim(), destination_airport: airport })
          toast({ kind: 'success', title: `${String(row.company_name)} is ready for orders` })
          void queryClient.invalidateQueries({ queryKey: ['list', 'customers'] })
          onDone()
        } catch (err) {
          setError((err as Error).message)
        }
      }}
    >
      <Field id={`${id}-cn`} label="Ordering contact">
        {(b) => <Input id={`${id}-cn`} value={d.contact_name} onChange={set('contact_name')} aria-describedby={b} autoComplete="off" />}
      </Field>
      <Field id={`${id}-ce`} label="Contact email">
        {(b) => <Input id={`${id}-ce`} type="email" value={d.contact_email} onChange={set('contact_email')} aria-describedby={b} autoComplete="off" />}
      </Field>
      <Field id={`${id}-co`} label="Country">
        {(b) => (
          <>
            <Input id={`${id}-co`} list={`${id}-countries`} value={d.country} onChange={set('country')} aria-describedby={b} />
            <datalist id={`${id}-countries`}>{(lists.data?.countries ?? []).map((c) => <option key={c} value={c} />)}</datalist>
          </>
        )}
      </Field>
      <Field id={`${id}-ap`} label="Destination airport" hint="Three letters, e.g. NRT, AMS, DXB.">
        {(b) => <Input id={`${id}-ap`} value={d.destination_airport ?? ''} maxLength={3} onChange={set('destination_airport')} aria-describedby={b} className="uppercase" />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${id}-ic`} label="Incoterm">
          {(b) => (
            <Select id={`${id}-ic`} value={d.incoterm} onChange={set('incoterm')} aria-describedby={b}>
              {[...new Set([d.incoterm, ...(lists.data?.incoterms ?? [])])].map((v) => <option key={v}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field id={`${id}-cu`} label="Currency">
          {(b) => (
            <Select id={`${id}-cu`} value={d.currency} onChange={set('currency')} aria-describedby={b}>
              {[...new Set([d.currency, ...(lists.data?.currencies ?? [])])].map((v) => <option key={v}>{v}</option>)}
            </Select>
          )}
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  )
}
