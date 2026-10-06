import { createFileRoute } from '@tanstack/react-router'
import { DataList } from '~/components/data-list'
import { rolesFor } from '~/components/layout/nav'

export const Route = createFileRoute('/_app/box-types')({
  head: () => ({ meta: [{ title: 'Box types · ConsolFlora' }] }),
  component: () => (
    <DataList
      roles={rolesFor('/box-types')}
      title="Box types"
      description="Outside dimensions as the airline measures them. Volumetric weight is L × W × H ÷ 6000."
      table="box_types"
      select="id, box_code, description, length_cm, width_cm, height_cm, tare_weight_kg, volumetric_kg, active"
      orderBy="box_code"
      searchKeys={['box_code', 'description']}
      columns={[
        { key: 'box_code', header: 'Code', className: 'font-semibold' },
        { key: 'description', header: 'Description' },
        { key: 'size', header: 'L × W × H (cm)', render: (r) => `${r.length_cm} × ${r.width_cm} × ${r.height_cm}` },
        { key: 'tare_weight_kg', header: 'Tare (kg)' },
        { key: 'volumetric_kg', header: 'Volumetric (kg)' },
      ]}
    />
  ),
})
