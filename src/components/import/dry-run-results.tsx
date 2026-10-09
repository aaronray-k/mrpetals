import * as React from 'react'
import { AlertTriangle, Download, XCircle } from 'lucide-react'
import type { DryRunResponse } from '~/server/import.functions'
import type { Issue } from '~/lib/import/validate'
import { downloadCsv, issuesToCsv } from '~/lib/import/errors-csv'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

const PAGE = 100

/** Icon plus the word "Error" or "Warning", so the type never depends on colour alone. */
function IssueType({ level }: { level: Issue['level'] }) {
return level === 'error' ? (
  <span className="inline-flex items-center gap-1 font-semibold text-destructive">
    <XCircle className="size-4" aria-hidden="true" /> Error
  </span>
) : (
  <span className="inline-flex items-center gap-1 font-semibold text-warning">
    <AlertTriangle className="size-4" aria-hidden="true" /> Warning
  </span>
)
}

/**
 * Dry run outcome. The page moves focus here when a run finishes, and the
 * summary is this region's label, so screen readers announce it once.
 */
export function DryRunResults({
  result,
  fileName,
  ref,
}: {
  result: DryRunResponse
  fileName: string
  ref?: React.Ref<HTMLDivElement>
}) {
  const [shown, setShown] = React.useState(PAGE)
  const errors = result.issues.filter((i) => i.level === 'error')
  const warnings = result.issues.filter((i) => i.level === 'warning')
  const { total, inserts, updates } = result.counts
  const visible = result.issues.slice(0, shown)
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <div ref={ref} tabIndex={-1} aria-labelledby="dry-run-summary" className="grid grid-cols-1 gap-4 outline-none">
      {result.ok ? (
        <Alert variant="success" title={<span id="dry-run-summary">Dry run clean: ready to import</span>}>
          {plural(total, 'row', 'rows')}: {inserts} new, {plural(updates, 'update', 'updates')}. Nothing is deleted.
          {warnings.length > 0 && ` ${plural(warnings.length, 'warning', 'warnings')} below won't stop the import.`}
        </Alert>
      ) : (
        <Alert
          variant="destructive"
          title={<span id="dry-run-summary">{plural(errors.length, 'problem', 'problems')} to fix before importing</span>}
        >
          Fix these in your spreadsheet, save it, then choose the file again and re-run the dry run.
        </Alert>
      )}

      {result.issues.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">
              {plural(errors.length, 'error', 'errors')}, {plural(warnings.length, 'warning', 'warnings')}
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(issuesToCsv(result.issues, result.sheet), `${fileName.replace(/\.xlsx$/i, '')}-${result.sheet}-errors.csv`)
              }
            >
              <Download aria-hidden="true" /> Download errors (CSV)
            </Button>
          </div>

          {/* Phones: one card per problem. */}
          <ul className="grid grid-cols-1 gap-2 sm:hidden" aria-label={`Problems found in the ${result.sheet} sheet`}>
            {visible.map((issue, i) => (
              <li key={i} className="rounded-lg border bg-card p-3">
                <p className="flex flex-wrap items-center gap-x-3 text-sm">
                  <IssueType level={issue.level} />
                  {issue.column && <span className="font-mono text-xs text-muted-foreground">{issue.column}</span>}
                </p>
                <p className="mt-1">{issue.message}</p>
              </li>
            ))}
          </ul>

          {/* Tablets and up: a table. */}
          <div className="hidden rounded-lg border bg-card sm:block">
            <Table>
              <caption className="sr-only">Problems found in the {result.sheet} sheet</caption>
              <THead>
                <TR>
                  <TH className="w-28">Type</TH>
                  <TH className="w-16">Row</TH>
                  <TH className="w-40">Column</TH>
                  <TH>Problem</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((issue, i) => (
                  <TR key={i}>
                    <TD>
                      <IssueType level={issue.level} />
                    </TD>
                    <TD className="tabular-nums">{issue.row ?? '—'}</TD>
                    <TD className="font-mono text-xs">{issue.column ?? '—'}</TD>
                    <TD>{issue.message}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {shown < result.issues.length && (
            <Button variant="outline" onClick={() => setShown((s) => s + PAGE)} className="justify-self-center">
              Show {Math.min(PAGE, result.issues.length - shown)} more of {result.issues.length - shown}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
