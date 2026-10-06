import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Upload } from 'lucide-react'
import { readXlsxFile, type ParsedWorkbook } from '~/lib/import/parse'
import { SHEETS, SHEET_ORDER, type SheetName } from '~/lib/import/schema'
import { dryRunImport, runImport, type DryRunResponse } from '~/server/import.functions'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { DownloadTemplateButton } from '~/components/download-template-button'
import { FileDrop } from '~/components/import/file-drop'
import { SheetPicker } from '~/components/import/sheet-picker'
import { DryRunResults } from '~/components/import/dry-run-results'
import { ImportHistory, importHistoryKey } from '~/components/import/import-history'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { useToast } from '~/components/ui/toaster'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/_app/import')({
  head: () => ({ meta: [{ title: 'Import · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/import')}>
      <ImportPage />
    </RequireRole>
  ),
})

function Step({ n, title, description, done, children }: { n: number; title: string; description?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-full border-2 font-bold',
              done ? 'border-accent bg-accent text-accent-foreground' : 'border-primary text-primary dark:border-accent dark:text-accent',
            )}
            aria-hidden="true"
          >
            {n}
          </span>
          <div className="grid gap-1">
            <CardTitle>
              <span className="sr-only">Step {n}: </span>
              {title}
              {done && <span className="sr-only"> (done)</span>}
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </li>
  )
}

function ImportPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [workbook, setWorkbook] = React.useState<ParsedWorkbook | null>(null)
  const [readError, setReadError] = React.useState<string | null>(null)
  const [reading, setReading] = React.useState(false)
  const [sheet, setSheet] = React.useState<SheetName | null>(null)
  const [dryRun, setDryRun] = React.useState<DryRunResponse | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [imported, setImported] = React.useState<SheetName[]>([])
  const resultsRef = React.useRef<HTMLDivElement>(null)

  async function onFile(file: File) {
    setReading(true)
    setReadError(null)
    setDryRun(null)
    try {
      const wb = await readXlsxFile(file)
      const known = wb.sheets.filter((s) => (SHEET_ORDER as readonly string[]).includes(s.name))
      if (known.length === 0) throw new Error('No template sheets were found in this file. Start from "Download template".')
      setWorkbook(wb)
      const first = SHEET_ORDER.find((s) => !imported.includes(s) && (wb.sheets.find((x) => x.name === s)?.rows.length ?? 0) > 0)
      setSheet(first ?? null)
      // The sheet list appears on screen; screen readers get the same news.
      toast({ kind: 'info', title: `Read ${file.name}`, description: `${known.length} template sheets found.`, visual: false })
    } catch (e) {
      setWorkbook(null)
      setReadError((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  async function onDryRun() {
    if (!workbook || !sheet) return
    setChecking(true)
    try {
      const res = await dryRunImport({ data: { workbook, sheet } })
      setDryRun(res)
      // Focus moves to the results, which reads out their summary.
      requestAnimationFrame(() => resultsRef.current?.focus())
    } catch (e) {
      toast({ kind: 'error', title: 'Dry run failed', description: (e as Error).message })
    } finally {
      setChecking(false)
    }
  }

  async function onImport() {
    if (!workbook || !sheet || !dryRun?.ok) return
    setImporting(true)
    try {
      const res = await runImport({ data: { workbook, sheet } })
      if (res.status === 'imported') {
        toast({ kind: 'success', title: `${sheet} imported`, description: `${res.inserted} new, ${res.updated} updated.` })
        const done = [...imported, sheet]
        setImported(done)
        setDryRun(null)
        const next = SHEET_ORDER.find((s) => !done.includes(s) && (workbook.sheets.find((x) => x.name === s)?.rows.length ?? 0) > 0)
        setSheet(next ?? null)
        void queryClient.invalidateQueries({ queryKey: ['list'] })
      } else if (res.status === 'blocked') {
        setDryRun(res.dryRun)
        toast({ kind: 'error', title: 'Import stopped', description: 'The data changed since the dry run. Check the new problems below.' })
        requestAnimationFrame(() => resultsRef.current?.focus())
      } else {
        toast({ kind: 'error', title: 'Import failed, nothing was saved', description: res.message })
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Import failed, nothing was saved', description: (e as Error).message })
    } finally {
      setImporting(false)
      void queryClient.invalidateQueries({ queryKey: importHistoryKey })
    }
  }

  const sheetRows = sheet ? (workbook?.sheets.find((s) => s.name === sheet)?.rows.length ?? 0) : 0

  return (
    <>
      <PageHeader
        title="Import"
        description="Load farms, customers, products, prices and packing lists from the ConsolFlora Excel template."
        actions={<DownloadTemplateButton />}
      />

      <div className="grid grid-cols-1 gap-4">
        <Tip id="import.how" title="How importing works">
          Pick a sheet and run a <strong>dry run</strong> first: it checks every row and saves nothing. When it's clean,
          press <strong>Import</strong>. Existing codes are updated, new codes are added, and nothing is ever deleted
          (set <strong>active</strong> to N to hide a record).
        </Tip>

        <ol className="grid grid-cols-1 gap-4">
          <Step n={1} title="Choose your file" description="The filled-in ConsolFlora import template (.xlsx)." done={!!workbook}>
            <div className="grid grid-cols-1 gap-3">
              <FileDrop onFile={onFile} fileName={workbook?.fileName} busy={reading} />
              {readError && <Alert variant="destructive" title={readError} role="alert" />}
            </div>
          </Step>

          <Step n={2} title="Pick a sheet" description="Import one sheet at a time, top to bottom." done={!!sheet && !!workbook}>
            {workbook ? (
              <SheetPicker
                workbook={workbook}
                value={sheet}
                importedThisSession={imported}
                onChange={(s) => {
                  setSheet(s)
                  setDryRun(null)
                }}
              />
            ) : (
              <p className="text-muted-foreground">Choose a file first.</p>
            )}
          </Step>

          <Step
            n={3}
            title="Dry run"
            description="Checks required fields, codes on other sheets, number ranges and duplicates. Saves nothing."
            done={!!dryRun?.ok}
          >
            <div className="grid grid-cols-1 gap-4">
              <Button onClick={onDryRun} disabled={!workbook || !sheet || checking} className="justify-self-start">
                <ClipboardCheck aria-hidden="true" />
                {checking ? 'Checking…' : sheet ? `Check ${sheetRows} ${sheetRows === 1 ? 'row' : 'rows'} on ${sheet}` : 'Run dry run'}
              </Button>
              {dryRun && workbook && <DryRunResults ref={resultsRef} result={dryRun} fileName={workbook.fileName} />}
            </div>
          </Step>

          <Step n={4} title="Import" description="Only possible after a clean dry run. Everything is saved together, or nothing is.">
            <div className="grid gap-2">
              <Button variant="accent" size="lg" onClick={onImport} disabled={!dryRun?.ok || importing} className="justify-self-start">
                <Upload aria-hidden="true" />
                {importing
                  ? 'Importing…'
                  : dryRun?.ok && sheet
                    ? `Import ${dryRun.counts.total} ${dryRun.counts.total === 1 ? 'row' : 'rows'} into ${SHEETS[sheet].name}`
                    : 'Import'}
              </Button>
              {!dryRun?.ok && (
                <p className="text-sm text-muted-foreground" id="import-locked">
                  The Import button unlocks when the dry run for this sheet is clean.
                </p>
              )}
            </div>
          </Step>
        </ol>

        <ImportHistory />
      </div>
    </>
  )
}
