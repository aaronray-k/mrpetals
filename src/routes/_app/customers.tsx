import { createFileRoute } from '@tanstack/react-router'
import { DataList } from '~/components/data-list'
import { rolesFor } from '~/components/layout/nav'

const money = (currency: unknown, value: unknown) =>
  value == null ? 'No credit' : `${currency} ${Number(value).toLocaleString('en-GB')}`

export const Route = createFileRoute('/_app/customers')({
  head: () => ({ meta: [{ title: 'Customers · ConsolFlora' }] }),
  component: () => (
    <DataList
      roles={rolesFor('/customers')}
      title="Customers"
      description="Buyers, their delivery terms and credit limits."
      table="customers"
      select="id, customer_code, company_name, country, city, contact_name, currency, incoterm, payment_terms, credit_limit, destination_airport, active"
      orderBy="customer_code"
      searchKeys={['customer_code', 'company_name', 'city', 'contact_name']}
      columns={[
        { key: 'customer_code', header: 'Code', className: 'font-semibold' },
        { key: 'company_name', header: 'Company' },
        { key: 'country', header: 'Country' },
        { key: 'destination_airport', header: 'Airport' },
        { key: 'incoterm', header: 'Incoterm' },
        { key: 'payment_terms', header: 'Terms' },
        { key: 'credit_limit', header: 'Credit limit', render: (r) => money(r.currency, r.credit_limit) },
      ]}
    />
  ),
})
