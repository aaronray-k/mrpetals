import { createFileRoute } from '@tanstack/react-router'
import { DataList } from '~/components/data-list'
import { rolesFor } from '~/components/layout/nav'

export const Route = createFileRoute('/_app/products')({
  head: () => ({ meta: [{ title: 'Products · ConsolFlora' }] }),
  component: () => (
    <DataList
      roles={rolesFor('/products')}
      title="Products"
      description="Each code is one flower, variety, grade and stem length."
      table="products"
      select="id, product_code, flower_type, variety, colour, grade, stem_length_cm, stems_per_bunch, vbn_code, active"
      orderBy="product_code"
      searchKeys={['product_code', 'flower_type', 'variety', 'colour', 'vbn_code']}
      columns={[
        { key: 'product_code', header: 'Code', className: 'font-semibold' },
        { key: 'flower_type', header: 'Flower' },
        { key: 'variety', header: 'Variety' },
        { key: 'colour', header: 'Colour' },
        { key: 'grade', header: 'Grade' },
        { key: 'stem_length_cm', header: 'Length (cm)' },
        { key: 'stems_per_bunch', header: 'Stems / bunch' },
        { key: 'vbn_code', header: 'VBN' },
      ]}
    />
  ),
})
