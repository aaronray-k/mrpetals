import * as React from 'react'
import { Image, Lock, Plus, Search, Type } from 'lucide-react'
import { FIELD_GROUPS, LABEL_FIELDS } from '~/lib/labels/fields'
import { elementName, isLocked, newElement, type LabelDesign, type LabelElement } from '~/lib/labels/layout'
import { Input, Label } from '~/components/ui/input'
import { cn } from '~/lib/utils'
import type { DesignerAction } from './use-designer'

/** "Add to label": pick a field, free text or the logo. */
export function FieldPicker({
  design,
  dispatch,
  onAdded,
}: {
  design: LabelDesign
  dispatch: React.Dispatch<DesignerAction>
  onAdded: (el: LabelElement) => void
}) {
  const [query, setQuery] = React.useState('')
  const q = query.trim().toLowerCase()
  const hasLogo = design.layout.elements.some((e) => e.type === 'logo')
  const add = (el: LabelElement) => {
    dispatch({ type: 'add', element: el })
    onAdded(el)
  }

  return (
    <section aria-labelledby="add-title" className="grid gap-3">
      <h2 id="add-title" className="text-lg font-bold">
        Add to label
      </h2>
      <div className="grid gap-1">
        <Label htmlFor="field-search">Find a field</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="field-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="e.g. grade, AWB" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <PickButton onClick={() => add(newElement('text', design.widthMm, design.heightMm, undefined, design.layout.elements))}>
          <Type aria-hidden="true" /> Text
        </PickButton>
        <PickButton onClick={() => add(newElement('logo', design.widthMm, design.heightMm, undefined, design.layout.elements))} disabled={hasLogo} title={hasLogo ? 'The label already has the logo' : undefined}>
          <Image aria-hidden="true" /> Logo
        </PickButton>
      </div>
      <div className="grid max-h-80 gap-3 overflow-y-auto pr-1">
        {FIELD_GROUPS.map((group) => {
          const fields = LABEL_FIELDS.filter((f) => f.group === group && (!q || f.en.toLowerCase().includes(q) || f.nl.toLowerCase().includes(q)))
          if (!fields.length) return null
          return (
            <div key={group} className="grid gap-1">
              <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{group}</p>
              <ul className="grid gap-1">
                {fields.map((f) => (
                  <li key={f.key}>
                    <button
                      type="button"
                      onClick={() => add(newElement('field', design.widthMm, design.heightMm, f.key, design.layout.elements))}
                      className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 text-left hover:border-input hover:bg-muted"
                    >
                      <span>
                        {f.en} <span className="text-sm text-muted-foreground">· {f.nl}</span>
                      </span>
                      <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="sr-only">Add to label</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PickButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  )
}

/** Everything on the label, as a list: the keyboard and screen reader way to pick an element. */
export function ElementList({
  elements,
  selectedId,
  flaggedIds,
  dispatch,
}: {
  elements: LabelElement[]
  selectedId: string | null
  flaggedIds: Set<string>
  dispatch: React.Dispatch<DesignerAction>
}) {
  return (
    <section aria-labelledby="elements-title" className="grid gap-2">
      <h2 id="elements-title" className="text-lg font-bold">
        On this label
      </h2>
      <ul className="grid gap-1">
        {elements.map((el) => (
          <li key={el.id}>
            <button
              type="button"
              aria-pressed={el.id === selectedId}
              onClick={() => dispatch({ type: 'select', id: el.id })}
              className={cn(
                'flex min-h-10 w-full items-center justify-between gap-2 rounded-md border px-2 text-left text-sm',
                el.id === selectedId ? 'border-accent bg-accent/15 font-semibold' : 'border-transparent hover:bg-muted',
              )}
            >
              <span className="truncate">
                {elementName(el)}
                {flaggedIds.has(el.id) && <span className="ml-1 font-semibold text-warning">· check</span>}
              </span>
              {isLocked(el) && (
                <>
                  <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">(always on the label)</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
