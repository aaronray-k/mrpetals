import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Tags } from 'lucide-react'
import { labelKeys, saveTemplate, useBuyers, useTemplates, type BuyerOption, type TemplateSummary } from '~/lib/labels/api'
import { SAMPLE_LABEL_DATA } from '~/lib/labels/data'
import { renderLabel } from '~/lib/labels/engine'
import { DEFAULT_SIZE, SIZE_PRESETS, defaultLayout, defaultOrientation } from '~/lib/labels/layout'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { LabelSvg } from '~/components/labels/label-svg'
import { UsedForSelect, usedForPatch } from '~/components/labels/template-settings'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { formatDateTime } from '~/lib/utils'

export const Route = createFileRoute('/_app/labels/')({
  head: () => ({ meta: [{ title: 'Label designer · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/labels')}>
      <LabelTemplatesPage />
    </RequireRole>
  ),
})

function usedForText(t: TemplateSummary, buyers: BuyerOption[]) {
  if (t.isDefault) return 'Default for all buyers'
  if (t.customerId) return buyers.find((b) => b.id === t.customerId)?.name ?? 'One buyer'
  return 'Not in use yet'
}

function LabelTemplatesPage() {
  const templates = useTemplates()
  const buyers = useBuyers()
  const dialog = React.useRef<HTMLDialogElement>(null)
  const hasDefault = templates.data?.some((t) => t.isDefault) ?? false

  return (
    <>
      <PageHeader
        title="Label designer"
        description="What prints on every box label, and for which buyer."
        actions={
          <Button onClick={() => dialog.current?.showModal()}>
            <Plus aria-hidden="true" /> New template
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="labels.list" title="How label templates work">
          The <strong>default</strong> template prints for every buyer without their own. A buyer can have one template of
          their own. Saving a template makes a new version; printed labels remember which version they used.
        </Tip>

        {templates.isLoading && <Spinner />}
        {templates.error && (
          <Alert variant="destructive" title="Couldn't load the templates" role="alert">
            {(templates.error as Error).message}
          </Alert>
        )}
        {templates.data?.length === 0 && (
          <Card className="grid justify-items-start gap-3 p-6">
            <Tags className="size-8 text-accent" aria-hidden="true" />
            <p className="text-lg font-bold">No label templates yet</p>
            <p className="text-muted-foreground">Start with the default template. It begins with a ready-made 150 × 70 mm layout you can change.</p>
            <Button onClick={() => dialog.current?.showModal()}>
              <Plus aria-hidden="true" /> Create the default template
            </Button>
          </Card>
        )}
        {templates.data && templates.data.length > 0 && (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {templates.data.map((t) => (
              <li key={t.id}>
                <Link
                  to="/labels/$templateId"
                  params={{ templateId: t.id }}
                  className="group grid h-full gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-accent"
                >
                  <div className="grid h-44 place-items-center rounded-md bg-muted/70 p-3">
                    {t.design && (
                      <LabelSvg
                        label={renderLabel(t.design, SAMPLE_LABEL_DATA)}
                        title={`Preview of ${t.name}`}
                        className="max-h-full max-w-full rounded-sm shadow ring-1 ring-black/10"
                        style={{ aspectRatio: `${t.design.widthMm} / ${t.design.heightMm}` }}
                      />
                    )}
                  </div>
                  <div className="grid gap-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold group-hover:underline">
                      {t.name}
                      {t.isDefault && <Badge variant="success">Default</Badge>}
                    </p>
                    <p className="text-sm">{usedForText(t, buyers.data ?? [])}</p>
                    {t.design && (
                      <p className="text-sm text-muted-foreground">
                        {t.design.widthMm} × {t.design.heightMm} mm · {t.design.orientation === 'rotated' ? 'fed sideways' : 'fed top first'}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Version {t.currentVersion} · saved {formatDateTime(t.updatedAt)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <NewTemplateDialog dialogRef={dialog} buyers={buyers.data ?? []} hasDefault={hasDefault} />
    </>
  )
}

function NewTemplateDialog({ dialogRef, buyers, hasDefault }: { dialogRef: React.RefObject<HTMLDialogElement | null>; buyers: BuyerOption[]; hasDefault: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = React.useState('')
  const [size, setSize] = React.useState<string>(DEFAULT_SIZE.id)
  const [usedFor, setUsedFor] = React.useState<string>(hasDefault ? 'none' : 'default')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => setUsedFor(hasDefault ? 'none' : 'default'), [hasDefault])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the template a name.')
      return
    }
    const preset = SIZE_PRESETS.find((p) => p.id === size) ?? DEFAULT_SIZE
    setBusy(true)
    setError(null)
    try {
      const r = await saveTemplate({
        templateId: null,
        name: name.trim(),
        ...usedForPatch(usedFor),
        design: { widthMm: preset.w, heightMm: preset.h, orientation: defaultOrientation(preset.w, preset.h), layout: defaultLayout(preset.w, preset.h) },
        expectedVersion: null,
      })
      void queryClient.invalidateQueries({ queryKey: labelKeys.all })
      dialogRef.current?.close()
      void navigate({ to: '/labels/$templateId', params: { templateId: r.templateId } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="new-template-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50"
    >
      <form onSubmit={onSubmit} className="grid gap-4 p-6" noValidate>
        <h2 id="new-template-title" className="text-xl font-bold">
          New label template
        </h2>
        {error && <Alert variant="destructive" title={error} role="alert" />}
        <Field id="new-name" label="Name">
          {(d) => <Input id="new-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-describedby={d} required autoFocus />}
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Size (you can set a custom size later)</legend>
          {SIZE_PRESETS.map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input type="radio" name="new-size" className="size-5 accent-accent" checked={size === p.id} onChange={() => setSize(p.id)} />
              {p.label}
              {p.id === DEFAULT_SIZE.id && <span className="text-sm text-muted-foreground">(default)</span>}
            </label>
          ))}
        </fieldset>
        <Field id="new-used-for" label="Used for" hint={hasDefault ? 'There is already a default template.' : undefined}>
          {(d) => <UsedForSelect id="new-used-for" value={usedFor} buyers={buyers} onChange={setUsedFor} describedBy={d} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create and open'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
