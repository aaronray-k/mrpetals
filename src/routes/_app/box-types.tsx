import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { setBoxPackagingCode, useFloricode } from '~/lib/floricode/api'
import { DataList } from '~/components/data-list'
import { rolesFor } from '~/components/layout/nav'
import { Field, Input, Select } from '~/components/ui/input'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { getSupabase } from '~/lib/supabase'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/box-types')({
  head: () => ({ meta: [{ title: 'Box types · ConsolFlora' }] }),
  component: () => (
    <DataList
      roles={rolesFor('/box-types')}
      title="Box types"
      description="Outside dimensions as the airline measures them. Volumetric weight is L × W × H ÷ 6000."
      table="box_types"
      select="id, box_code, description, length_cm, width_cm, height_cm, tare_weight_kg, volumetric_kg, vbn_packaging_code, size_basis, wall_mm, bulge_top_mm, bulge_side_mm, bulge_end_mm, active"
      orderBy="box_code"
      searchKeys={['box_code', 'description', 'vbn_packaging_code']}
      columns={[
        { key: 'box_code', header: 'Code', className: 'font-semibold' },
        { key: 'description', header: 'Description' },
        { key: 'size', header: 'L × W × H (cm)', render: (r) => `${r.length_cm} × ${r.width_cm} × ${r.height_cm}` },
        { key: 'tare_weight_kg', header: 'Tare (kg)' },
        { key: 'volumetric_kg', header: 'Volumetric (kg)' },
        { key: 'bulge_top_mm', header: 'Thickness and bulge', render: (r) => <Allowances row={r} /> },
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

/**
 * A box type's board thickness (when its sizes are measured inside) and how far a full box bulges in the middle of
 * each face. The load planner adds these to the space each box takes; load checks tune them.
 */
function Allowances({ row }: { row: Record<string, unknown> }) {
  const { roles } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState({
    size_basis: String(row.size_basis ?? 'outside'),
    wall_mm: String(row.wall_mm ?? 5),
    bulge_top_mm: String(row.bulge_top_mm ?? 10),
    bulge_side_mm: String(row.bulge_side_mm ?? 5),
    bulge_end_mm: String(row.bulge_end_mm ?? 0),
  })
  const summary = `${row.size_basis === 'inside' ? `inside + ${row.wall_mm} mm walls` : 'outside'}; bulge ${row.bulge_top_mm}/${row.bulge_side_mm}/${row.bulge_end_mm} mm`
  if (!hasAnyRole(roles, STAFF_ROLES)) return summary
  const code = String(row.box_code)
  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{summary}</span>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Edit<span className="sr-only"> thickness and bulge of {code}</span>
        </Button>
      </span>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${code}: thickness and bulge`} description="Bulge is per face (top/bottom, long sides, ends): a box takes its size plus the bulge on both faces.">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            const n = (x: string) => Number(x.replace(',', '.'))
            const patch = { size_basis: v.size_basis, wall_mm: n(v.wall_mm), bulge_top_mm: n(v.bulge_top_mm), bulge_side_mm: n(v.bulge_side_mm), bulge_end_mm: n(v.bulge_end_mm) }
            if ([patch.wall_mm, patch.bulge_top_mm, patch.bulge_side_mm, patch.bulge_end_mm].some((x) => !Number.isFinite(x) || x < 0 || x > 100))
              return toast({ kind: 'error', title: 'Enter mm from 0 to 100' })
            const { error } = await getSupabase().from('box_types').update(patch).eq('id', String(row.id))
            if (error) return toast({ kind: 'error', title: 'Not saved', description: error.message })
            toast({ kind: 'success', title: `${code} saved` })
            setOpen(false)
            void queryClient.invalidateQueries({ queryKey: ['list', 'box_types'] })
          }}
        >
          <Field id={`al-basis-${code}`} label="Sizes are measured">
            {(d) => (
              <Select id={`al-basis-${code}`} value={v.size_basis} onChange={(e) => setV({ ...v, size_basis: e.target.value })} aria-describedby={d}>
                <option value="outside">Outside (as the airline measures)</option>
                <option value="inside">Inside</option>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['wall_mm', 'Board thickness (mm)'],
                ['bulge_top_mm', 'Bulge, top and bottom (mm)'],
                ['bulge_side_mm', 'Bulge, long sides (mm)'],
                ['bulge_end_mm', 'Bulge, ends (mm)'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} id={`al-${k}-${code}`} label={label}>
                {(d) => <Input id={`al-${k}-${code}`} inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-describedby={d} />}
              </Field>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
