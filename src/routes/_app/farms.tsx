import { createFileRoute } from '@tanstack/react-router'
import { DataList } from '~/components/data-list'
import { rolesFor } from '~/components/layout/nav'
import { Tip } from '~/components/tips/tips'

export const Route = createFileRoute('/_app/farms')({
  head: () => ({ meta: [{ title: 'Farms · ConsolFlora' }] }),
  component: () => (
    <DataList
      roles={rolesFor('/farms')}
      title="Farms"
      description="Growers we buy from, with their sales agent and payment terms."
      table="farms"
      select="id, farm_code, farm_name, country, region, sales_agent_name, sales_agent_email, currency, payment_terms, active"
      orderBy="farm_code"
      searchKeys={['farm_code', 'farm_name', 'region', 'sales_agent_name']}
      columns={[
        { key: 'farm_code', header: 'Code', className: 'font-semibold' },
        { key: 'farm_name', header: 'Name' },
        { key: 'country', header: 'Country' },
        { key: 'region', header: 'Region' },
        { key: 'sales_agent_name', header: 'Sales agent' },
        { key: 'currency', header: 'Currency' },
        { key: 'payment_terms', header: 'Terms' },
      ]}
      tip={
        <Tip id="farms.inactive" title="Hiding a farm">
          Records are never deleted. Set <strong>active</strong> to N in the template and import it again to hide a farm
          from new POs; its history stays.
        </Tip>
      }
    />
  ),
})
