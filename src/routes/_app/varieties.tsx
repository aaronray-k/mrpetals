import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Flower2, Search } from 'lucide-react'
import { getSupabase } from '~/lib/supabase'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'

export const Route = createFileRoute('/_app/varieties')({
  head: () => ({ meta: [{ title: 'Varieties · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/varieties')}>
      <Varieties />
    </RequireRole>
  ),
})

interface Variety {
  id: string
  flower_type: string
  name: string
  grade: string | null
  colour: string | null
  photo: string | null
  active: boolean
  lengths: number[]
  growers: string[]
  grower_groups: string[]
}

const PAGE = 60

function Varieties() {
  const list = useQuery({
    queryKey: ['variety-overview'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('variety_overview')
      if (error) throw new Error(error.message)
      return (data ?? []) as Variety[]
    },
  })
  const [search, setSearch] = React.useState('')
  const [type, setType] = React.useState('')
  const [photo, setPhoto] = React.useState<'all' | 'with' | 'without'>('all')
  const [shown, setShown] = React.useState(PAGE)
  const [open, setOpen] = React.useState<Variety | null>(null)
  const all = list.data ?? []
  const types = [...new Set(all.map((v) => v.flower_type))].sort()
  const term = search.trim().toLowerCase()
  const rows = all.filter(
    (v) =>
      (!type || v.flower_type === type) &&
      (photo === 'all' || (photo === 'with') === !!v.photo) &&
      (!term || [v.name, v.colour ?? '', v.grade ?? '', ...v.growers, ...v.grower_groups].some((s) => s.toLowerCase().includes(term))),
  )
  React.useEffect(() => setShown(PAGE), [search, type, photo])

  return (
    <>
      <PageHeader
        title="Varieties"
        description="Every flower in the webshop, once per variety, with its catalogue photo, stem lengths and who grows it."
      />
      <div className="grid grid-cols-1 gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem_12rem] sm:items-end">
          <Field id="v-search" label="Search">
            {(d) => (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="v-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" aria-describedby={d} placeholder="Variety, colour or farm" />
              </div>
            )}
          </Field>
          <Field id="v-type" label="Flower">
            {(d) => (
              <Select id="v-type" value={type} onChange={(e) => setType(e.target.value)} aria-describedby={d}>
                <option value="">All flowers ({all.length.toLocaleString('en-GB')})</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t} ({all.filter((v) => v.flower_type === t).length})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="v-photo" label="Photo">
            {(d) => (
              <Select id="v-photo" value={photo} onChange={(e) => setPhoto(e.target.value as typeof photo)} aria-describedby={d}>
                <option value="all">All</option>
                <option value="with">With a photo ({all.filter((v) => v.photo).length})</option>
                <option value="without">No photo yet ({all.filter((v) => !v.photo).length})</option>
              </Select>
            )}
          </Field>
        </div>

        {list.isLoading && <Spinner />}
        {list.error && <Alert variant="destructive" title="Couldn't load varieties">{(list.error as Error).message}</Alert>}
        {list.data && !all.length && (
          <Alert title="No varieties yet">
            Load the master price file under <Link to="/master-import" className="font-semibold underline">Tools → Master price file</Link>.
          </Alert>
        )}
        {all.length > 0 && (
          <p className="text-sm text-muted-foreground" role="status">
            {rows.length.toLocaleString('en-GB')} of {all.length.toLocaleString('en-GB')} varieties
          </p>
        )}

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.slice(0, shown).map((v) => (
            <li key={v.id}>
              <Card className="h-full">
                <button type="button" onClick={() => setOpen(v)} className="grid h-full w-full content-start gap-2 rounded-lg p-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <Photo v={v} className="h-36" />
                  <span className="font-semibold">{v.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {v.flower_type}
                    {v.grade ? ` · ${v.grade}` : ''}
                    {v.colour ? ` · ${v.colour}` : ''}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {v.lengths.map((l) => (
                      <Badge key={l} variant="outline">
                        {l} cm
                      </Badge>
                    ))}
                  </span>
                  <span className="text-sm">
                    Grown by {v.grower_groups.length} {v.grower_groups.length === 1 ? 'grower' : 'growers'}
                    {v.grower_groups.length ? `: ${v.grower_groups.slice(0, 3).join(', ')}${v.grower_groups.length > 3 ? '…' : ''}` : ''}
                  </span>
                </button>
              </Card>
            </li>
          ))}
        </ul>
        {rows.length > shown && (
          <div>
            <Button variant="outline" onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, rows.length - shown)} more
            </Button>
          </div>
        )}
      </div>

      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} description={open ? `${open.flower_type}${open.grade ? ` · ${open.grade}` : ''}${open.colour ? ` · ${open.colour}` : ''}` : undefined}>
        {open && (
          <div className="grid gap-3">
            <Photo v={open} className="h-56" />
            <p className="text-sm">Stem lengths: {open.lengths.length ? open.lengths.map((l) => `${l} cm`).join(', ') : 'none yet'}</p>
            <div>
              <h3 className="font-semibold">Grown by</h3>
              <ul className="list-disc pl-5 text-sm">
                {open.growers.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
            {!open.photo && <p className="text-sm text-muted-foreground">No catalogue photo for this variety yet.</p>}
          </div>
        )}
      </Dialog>
    </>
  )
}

function Photo({ v, className }: { v: Variety; className?: string }) {
  return v.photo ? (
    <img src={`/catalogue/${v.photo}`} alt={`${v.name} (${v.flower_type})`} loading="lazy" className={`w-full rounded-md bg-[#132a1c] object-contain p-2 ${className ?? ''}`} />
  ) : (
    <span className={`flex w-full items-center justify-center rounded-md bg-muted text-muted-foreground ${className ?? ''}`} aria-hidden="true">
      <Flower2 className="size-10" />
    </span>
  )
}
