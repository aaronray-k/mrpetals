import * as React from 'react'
import { AlertTriangle, CheckCircle2, Download, FileText, History, Printer } from 'lucide-react'
import type { DesignWarning } from '~/lib/labels/checks'
import type { TemplateVersion } from '~/lib/labels/api'
import { DPI_OPTIONS, type Dpi } from '~/lib/labels/units'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { cn, formatDateTime } from '~/lib/utils'
import type { DesignerAction } from './use-designer'

export function WarningsPanel({ warnings, dispatch }: { warnings: DesignWarning[]; dispatch: React.Dispatch<DesignerAction> }) {
  if (warnings.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-success" role="status">
        <CheckCircle2 className="size-4" aria-hidden="true" /> No layout problems found.
      </p>
    )
  }
  return (
    <section aria-labelledby="warnings-title" className="rounded-lg border border-warning/40 bg-warning-bg p-4">
      <h2 id="warnings-title" className="mb-2 flex items-center gap-2 font-bold">
        <AlertTriangle className="size-5 text-warning" aria-hidden="true" />
        {warnings.length === 1 ? '1 thing to check' : `${warnings.length} things to check`}
      </h2>
      <ul className="grid gap-1 text-sm">
        {warnings.map((w, i) => (
          <li key={i}>
            {w.elementIds[0] ? (
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => dispatch({ type: 'select', id: w.elementIds[0]! })}>
                {w.message}
              </button>
            ) : (
              w.message
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function TestPrintPanel({
  showReprint,
  onShowReprint,
  onPdf,
  onZpl,
  busy,
}: {
  showReprint: boolean
  onShowReprint: (on: boolean) => void
  onPdf: () => void
  onZpl: (dpi: Dpi) => void
  busy: boolean
}) {
  const [dpi, setDpi] = React.useState<Dpi>(203)
  return (
    <section aria-labelledby="test-print-title" className="grid gap-3">
      <h2 id="test-print-title" className="flex items-center gap-2 text-lg font-bold">
        <Printer className="size-5" aria-hidden="true" /> Test print
      </h2>
      <p className="-mt-1 text-sm text-muted-foreground">Prints the sample box with the layout as it is on screen, saved or not.</p>
      <Switch checked={showReprint} onCheckedChange={onShowReprint} label="Show the REPRINT mark" className="-ml-2 justify-self-start" />
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" onClick={onPdf} disabled={busy}>
          <FileText aria-hidden="true" /> PDF
        </Button>
        <fieldset className="flex items-center gap-1 rounded-md border border-input bg-card p-1">
          <legend className="sr-only">Zebra printer resolution</legend>
          {DPI_OPTIONS.map((d) => (
            <label key={d} className={cn('inline-flex h-8 cursor-pointer items-center rounded px-2 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', dpi === d && 'bg-accent/20')}>
              <input type="radio" name="dpi" value={d} checked={dpi === d} onChange={() => setDpi(d)} className="sr-only" />
              {d} dpi
            </label>
          ))}
        </fieldset>
        <Button variant="outline" onClick={() => onZpl(dpi)} disabled={busy}>
          <Download aria-hidden="true" /> ZPL for Zebra
        </Button>
      </div>
    </section>
  )
}

export function VersionHistory({
  versions,
  savedVersion,
  onOpen,
}: {
  versions: TemplateVersion[]
  savedVersion: number
  onOpen: (v: TemplateVersion) => void
}) {
  return (
    <section aria-labelledby="versions-title" className="grid gap-2">
      <h2 id="versions-title" className="flex items-center gap-2 text-lg font-bold">
        <History className="size-5" aria-hidden="true" /> Versions
      </h2>
      <p className="-mt-1 text-sm text-muted-foreground">Saved versions never change. Saving makes a new one.</p>
      <ol className="grid gap-1">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm odd:bg-muted/60">
            <span>
              <span className="font-semibold">Version {v.version}</span>
              {v.version === savedVersion && <span className="ml-1 text-success">(latest)</span>}
              <span className="block text-muted-foreground">
                {v.createdByName} · {formatDateTime(v.createdAt)}
              </span>
            </span>
            {v.version !== savedVersion && (
              <Button variant="ghost" size="sm" onClick={() => onOpen(v)}>
                Open
                <span className="sr-only"> version {v.version}</span>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
