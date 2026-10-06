import * as React from 'react'
import { Link, useBlocker } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Redo2, Save, Undo2 } from 'lucide-react'
import { labelKeys, saveTemplate, type BuyerOption, type TemplateVersion } from '~/lib/labels/api'
import { designWarnings } from '~/lib/labels/checks'
import { SAMPLE_LABEL_DATA } from '~/lib/labels/data'
import { renderLabel } from '~/lib/labels/engine'
import { elementName, layoutSchema, type LabelElement } from '~/lib/labels/layout'
import { downloadLabelsPdf, downloadLabelsZpl } from '~/lib/labels/output'
import type { Dpi } from '~/lib/labels/units'
import { Tip } from '~/components/tips/tips'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { useToast } from '~/components/ui/toaster'
import { DesignerCanvas } from './designer-canvas'
import { ElementList, FieldPicker } from './field-picker'
import { Inspector } from './inspector'
import { TestPrintPanel, VersionHistory, WarningsPanel } from './side-panels'
import { TemplateSettings } from './template-settings'
import { useDesigner, type TemplateMeta } from './use-designer'

export interface DesignerTemplate {
  id: string
  name: string
  customerId: string | null
  isDefault: boolean
  currentVersion: number
  versions: TemplateVersion[]
}

const fileSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'label'
const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export function Designer({ template, buyers }: { template: DesignerTemplate; buyers: BuyerOption[] }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const initial = React.useMemo(
    () => ({
      design: template.versions[0]!.design,
      meta: { name: template.name, customerId: template.customerId, isDefault: template.isDefault } satisfies TemplateMeta,
    }),
    [template],
  )
  const { state, dispatch, selected } = useDesigner(initial)
  const [savedVersion, setSavedVersion] = React.useState(template.currentVersion)
  const [savedJson, setSavedJson] = React.useState(() => JSON.stringify(initial))
  const [showReprint, setShowReprint] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const current = JSON.stringify({ design: state.design, meta: state.meta })
  const dirty = current !== savedJson
  const warnings = React.useMemo(() => designWarnings(state.design), [state.design])
  const flaggedIds = React.useMemo(() => new Set(warnings.flatMap((w) => w.elementIds)), [warnings])

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm('This label has unsaved changes. Leave without saving?'),
    enableBeforeUnload: () => dirty,
  })

  const save = React.useCallback(async () => {
    const name = state.meta.name.trim()
    if (!name) {
      toast({ kind: 'error', title: 'Not saved', description: 'Give the template a name first.' })
      return
    }
    const check = layoutSchema.safeParse(state.design.layout)
    if (!check.success) {
      toast({ kind: 'error', title: 'Not saved', description: check.error.issues[0]?.message })
      return
    }
    setBusy(true)
    try {
      const r = await saveTemplate({
        templateId: template.id,
        name,
        customerId: state.meta.customerId,
        isDefault: state.meta.isDefault,
        design: state.design,
        expectedVersion: savedVersion,
      })
      setSavedVersion(r.version)
      setSavedJson(current)
      toast({ kind: 'success', title: `Saved as version ${r.version}` })
      void queryClient.invalidateQueries({ queryKey: labelKeys.all })
    } catch (e) {
      toast({ kind: 'error', title: 'Not saved', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }, [state.meta, state.design, template.id, savedVersion, current, toast, queryClient])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        if (dirty && !busy) void save()
      } else if (!isEditable(e.target) && key === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (!isEditable(e.target) && key === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, busy, save, dispatch])

  const testLabel = () => renderLabel(state.design, SAMPLE_LABEL_DATA, { reprint: showReprint })
  const runOutput = async (what: string, fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      toast({ kind: 'success', title: `${what} downloaded` })
    } catch (e) {
      toast({ kind: 'error', title: `${what} failed`, description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const openVersion = (v: TemplateVersion) => {
    dispatch({ type: 'load', design: v.design, keepHistory: true })
    toast({ kind: 'info', title: `Version ${v.version} opened`, description: 'Save to make it the latest version. Undo goes back.' })
  }

  const onAdded = (el: LabelElement) =>
    toast({ kind: 'info', title: `${elementName(el)} added`, description: 'Drag it into place, or use the arrow keys.', visual: false })
  const onLockedDelete = (el: LabelElement) =>
    toast({ kind: 'info', title: `${elementName(el)} stays on the label`, description: 'You can move and resize it, but not remove it.' })

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <Link to="/labels" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" /> All label templates
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-primary dark:text-foreground">{state.meta.name || 'Untitled template'}</h1>
          <p className="text-sm" role="status">
            {dirty ? (
              <span className="font-semibold text-warning">Unsaved changes · based on version {savedVersion}</span>
            ) : (
              <span className="text-muted-foreground">Saved · version {savedVersion}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => dispatch({ type: 'undo' })} disabled={state.past.length === 0}>
            <Undo2 aria-hidden="true" /> Undo
          </Button>
          <Button variant="outline" onClick={() => dispatch({ type: 'redo' })} disabled={state.future.length === 0}>
            <Redo2 aria-hidden="true" /> Redo
          </Button>
          <Button variant="accent" onClick={() => void save()} disabled={!dirty || busy}>
            <Save aria-hidden="true" /> {busy ? 'Working…' : 'Save new version'}
          </Button>
        </div>
      </div>

      <Tip id="labels.designer" title="Designing a label">
        Drag things on the label, or select one and use the <strong>arrow keys</strong> (hold Shift for 5 mm steps). The
        corner handle resizes. The <strong>QR code</strong>, <strong>box ID</strong> and <strong>Box n of N</strong> are
        always on the label. Ctrl+Z undoes, Ctrl+S saves.
      </Tip>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
        <div className="order-first grid content-start gap-4 lg:order-none lg:col-start-2 lg:row-start-1">
          <DesignerCanvas state={state} dispatch={dispatch} showReprint={showReprint} flaggedIds={flaggedIds} onLockedDelete={onLockedDelete} />
          <WarningsPanel warnings={warnings} dispatch={dispatch} />
          <Card className="p-5">
            <TestPrintPanel
              showReprint={showReprint}
              onShowReprint={setShowReprint}
              busy={busy}
              onPdf={() => void runOutput('Test PDF', () => downloadLabelsPdf([testLabel()], `${fileSlug(state.meta.name)}-test.pdf`))}
              onZpl={(dpi: Dpi) => void runOutput('Test ZPL', () => downloadLabelsZpl([testLabel()], dpi, `${fileSlug(state.meta.name)}-test-${dpi}dpi.zpl`))}
            />
          </Card>
        </div>

        <div className="grid content-start gap-4 lg:col-start-1 lg:row-start-1">
          <Card className="p-5">
            <FieldPicker design={state.design} dispatch={dispatch} onAdded={onAdded} />
          </Card>
          <Card className="p-5">
            <ElementList elements={state.design.layout.elements} selectedId={state.selectedId} flaggedIds={flaggedIds} dispatch={dispatch} />
          </Card>
        </div>

        <div className="grid content-start gap-4 lg:col-start-3 lg:row-start-1">
          <Card className="p-5">
            {selected ? (
              <div className="grid gap-4">
                <Inspector key={selected.id} element={selected} widthMm={state.design.widthMm} heightMm={state.design.heightMm} dispatch={dispatch} />
                <button type="button" onClick={() => dispatch({ type: 'select', id: null })} className={buttonVariants({ variant: 'link', className: 'justify-self-start' })}>
                  Template settings
                </button>
              </div>
            ) : (
              <TemplateSettings design={state.design} meta={state.meta} buyers={buyers} dispatch={dispatch} />
            )}
          </Card>
          <Card className="p-5">
            <VersionHistory versions={template.versions} savedVersion={savedVersion} onOpen={openVersion} />
          </Card>
        </div>
      </div>
    </div>
  )
}

