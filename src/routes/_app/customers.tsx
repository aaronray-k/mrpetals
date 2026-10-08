import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { SERVICES, SERVICE_LABELS, setCustomerService, type Service } from '~/lib/fees/api'
import { setBuyerOdooTerm, useOdooPaymentTerms } from '~/lib/odoo/api'
import { DataList } from '~/components/data-list'
import { rolesFor } from '~/components/layout/nav'
import { Select } from '~/components/ui/input'
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
      table="customers"
      select="id, customer_code, company_name, country, city, contact_name, currency, incoterm, payment_terms, odoo_payment_term_id, odoo_payment_term_name, credit_limit, destination_airport, service, active"
      orderBy="customer_code"
      searchKeys={['customer_code', 'company_name', 'city', 'contact_name']}
      columns={[
        { key: 'customer_code', header: 'Code', className: 'font-semibold' },
        { key: 'company_name', header: 'Company' },
        { key: 'country', header: 'Country' },
        { key: 'destination_airport', header: 'Airport' },
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
