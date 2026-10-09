import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Search } from 'lucide-react'
import { getSupabase } from '~/lib/supabase'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole, type Role } from '~/lib/roles'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { DownloadTemplateButton } from '~/components/download-template-button'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { buttonVariants } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input, Label } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

type Row = Record<string, unknown> & { id: string; active?: boolean }

export interface Column {
  key: string
  header: string
  render?: (row: Row) => React.ReactNode
  className?: string
}

/** Read-only master data list. Changes come in through the Import page. */
export function DataList(props: DataListProps & { roles: Role[] }) {
  return (
    <RequireRole roles={props.roles}>
      <DataListInner {...props} />
    </RequireRole>
  )
}

interface DataListProps {
  title: string
  description: string
  table: string
  select: string
  orderBy: string
  columns: Column[]
  searchKeys: string[]
  tip?: React.ReactNode
}

function DataListInner({
  title,
  description,
  table,
  select,
  orderBy,
  columns,
  searchKeys,
  tip,
}: DataListProps) {
  const { roles } = useAuth()
  const [search, setSearch] = React.useState('')
  const [showInactive, setShowInactive] = React.useState(false)
  const query = useQuery({
    queryKey: ['list', table],
    queryFn: async () => {
      const { data, error } = await getSupabase().from(table).select(select).order(orderBy)
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })

  const term = search.trim().toLowerCase()
  const rows = (query.data ?? []).filter(
    (r) =>
      (showInactive || r.active !== false) &&
      (!term || searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(term))),
  )
  const searchId = `${table}-search`

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <DownloadTemplateButton />
            {hasAnyRole(roles, STAFF_ROLES) && (
              <Link to="/import" className={buttonVariants()}>
                <FileSpreadsheet aria-hidden="true" /> Import
              </Link>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        {tip}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor={searchId}>Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id={searchId} type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-6 accent-accent" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>

        {query.isLoading && <Spinner />}
        {query.error && (
          <Alert variant="destructive" title="Couldn't load this list" role="alert">
            {(query.error as Error).message}
          </Alert>
        )}
        {query.data && (
          <Card>
            <p className="sr-only" role="status">
              {rows.length} {rows.length === 1 ? 'record' : 'records'} shown
            </p>
            {rows.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground">
                {query.data.length === 0 ? 'Nothing here yet. Use Import to load records from the template.' : 'No records match your search.'}
              </p>
            ) : (
              <Table>
                <caption className="sr-only">{title}</caption>
                <THead>
                  <TR>
                    {columns.map((c) => (
                      <TH key={c.key}>{c.header}</TH>
                    ))}
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      {columns.map((c) => (
                        <TD key={c.key} className={c.className}>
                          {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                        </TD>
                      ))}
                      <TD>{r.active === false ? <Badge>Inactive</Badge> : <Badge variant="success">Active</Badge>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  )
}
