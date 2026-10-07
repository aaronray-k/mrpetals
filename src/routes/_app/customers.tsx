import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { SERVICES, SERVICE_LABELS, setCustomerService, type Service } from '~/lib/fees/api'
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
      select="id, customer_code, company_name, country, city, contact_name, currency, incoterm, payment_terms, credit_limit, destination_airport, service, active"
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
