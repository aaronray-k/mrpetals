import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { getSupabase } from '~/lib/supabase'
import { formatDateTime } from '~/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

interface Run {
  id: string
  user_id: string
  file_name: string
  sheet: string
  status: 'succeeded' | 'failed'
  rows_total: number
  inserted: number
  updated: number
  message: string | null
  created_at: string
}

export const importHistoryKey = ['import_runs'] as const

function RunResult({ run }: { run: Run }) {
  return run.status === 'succeeded' ? (
    <span className="inline-flex items-center gap-1 text-success">
      <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
      {run.inserted} new, {run.updated} updated
    </span>
  ) : (
    <span className="inline-flex items-start gap-1 text-destructive">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      Failed: {run.message}
    </span>
  )
}

export function ImportHistory() {
  const q = useQuery({
    queryKey: importHistoryKey,
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('import_runs')
        .select('id, user_id, file_name, sheet, status, rows_total, inserted, updated, message, created_at')
        .order('created_at', { ascending: false })
        .limit(25)
      if (error) throw error
      const runs = (data ?? []) as Run[]
      const ids = [...new Set(runs.map((r) => r.user_id))]
      const { data: people } = ids.length
        ? await supabase.from('profiles').select('id, full_name').in('id', ids)
        : { data: [] as { id: string; full_name: string | null }[] }
      const names = new Map((people ?? []).map((p) => [p.id, p.full_name]))
      return runs.map((r) => ({ ...r, who: names.get(r.user_id) || 'Unknown user' }))
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent imports</CardTitle>
        <CardDescription>Who imported what, and when. The log can't be edited.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {q.isLoading && <Spinner className="px-5" />}
        {q.error && <p className="px-5 text-destructive">Couldn't load the import log.</p>}
        {q.data && q.data.length === 0 && <p className="px-5 pb-3 text-muted-foreground">No imports yet.</p>}
        {q.data && q.data.length > 0 && (
          <>
            {/* Phones: one line per import. */}
            <ul className="grid grid-cols-1 divide-y border-t sm:hidden" aria-label="Recent imports">
              {q.data.map((r) => (
                <li key={r.id} className="grid gap-0.5 px-5 py-3">
                  <p className="font-semibold">{r.sheet}</p>
                  <RunResult run={r} />
                  <p className="text-sm text-muted-foreground">
                    {r.who} · {formatDateTime(r.created_at)} · <span className="break-all">{r.file_name}</span>
                  </p>
                </li>
              ))}
            </ul>

            <div className="hidden sm:block">
              <Table>
                <caption className="sr-only">Recent imports</caption>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Who</TH>
                    <TH>Sheet</TH>
                    <TH>File</TH>
                    <TH>Result</TH>
                  </TR>
                </THead>
                <TBody>
                  {q.data.map((r) => (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(r.created_at)}</TD>
                      <TD>{r.who}</TD>
                      <TD className="font-semibold">{r.sheet}</TD>
                      <TD className="max-w-48 truncate" title={r.file_name}>
                        {r.file_name}
                      </TD>
                      <TD>
                        <RunResult run={r} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
