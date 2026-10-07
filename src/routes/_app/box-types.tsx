import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { setBoxPackagingCode, useFloricode } from '~/lib/floricode/api'
import { DataList } from '~/components/data-list'
import { rolesFor } from '~/components/layout/nav'
import { Select } from '~/components/ui/input'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/box-types')({
  head: () => ({ meta: [{ title: 'Box types · ConsolFlora' }] }),
  component: () => (
    <DataList
      roles={rolesFor('/box-types')}
      title="Box types"
      description="Outside dimensions as the airline measures them. Volumetric weight is L × W × H ÷ 6000."
      table="box_types"
      select="id, box_code, description, length_cm, width_cm, height_cm, tare_weight_kg, volumetric_kg, vbn_packaging_code, active"
      orderBy="box_code"
      searchKeys={['box_code', 'description', 'vbn_packaging_code']}
      columns={[
        { key: 'box_code', header: 'Code', className: 'font-semibold' },
        { key: 'description', header: 'Description' },
        { key: 'size', header: 'L × W × H (cm)', render: (r) => `${r.length_cm} × ${r.width_cm} × ${r.height_cm}` },
        { key: 'tare_weight_kg', header: 'Tare (kg)' },
        { key: 'volumetric_kg', header: 'Volumetric (kg)' },
        {
          key: 'vbn_packaging_code',
          header: 'Floricode packaging',
          render: (r) => <PackagingCode boxTypeId={r.id} boxCode={String(r.box_code)} code={(r.vbn_packaging_code as string | null) ?? ''} />,
        },
      ]}
    />
  ),
})

/** Staff pick the box type's Floricode packaging code; it goes on the label and into the QR code. */
function PackagingCode({ boxTypeId, boxCode, code }: { boxTypeId: string; boxCode: string; code: string }) {
  const { roles } = useAuth()
  const fc = useFloricode()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [value, setValue] = React.useState(code)
  const name = fc.data?.packaging.find((p) => p.code === code)?.name
  if (!hasAnyRole(roles, STAFF_ROLES)) return code ? `${code}${name ? ` · ${name}` : ''}` : '—'
  return (
    <>
      <label className="sr-only" htmlFor={`pkg-${boxTypeId}`}>
        Floricode packaging code for {boxCode}
      </label>
      <Select
        id={`pkg-${boxTypeId}`}
        value={value}
        className="min-w-48"
        onChange={async (e) => {
          const next = e.target.value
          setValue(next)
          try {
            await setBoxPackagingCode(boxTypeId, next)
            toast({ kind: 'success', title: `${boxCode} packaging code saved` })
            void queryClient.invalidateQueries({ queryKey: ['list', 'box_types'] })
          } catch (err) {
            setValue(code)
            toast({ kind: 'error', title: 'Not saved', description: (err as Error).message })
          }
        }}
      >
        <option value="">Not set</option>
        {(fc.data?.packaging ?? [])
          .filter((p) => p.status === 'active' || p.code === value)
          .map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.name}
            </option>
          ))}
      </Select>
    </>
  )
}
