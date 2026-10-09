import { DEFAULT_SIZE, MAX_SIZE_MM, MIN_SIZE_MM, SIZE_PRESETS, defaultOrientation, type LabelDesign } from '~/lib/labels/layout'
import { SAMPLE_LABEL_DATA } from '~/lib/labels/data'
import { ACTIVE_QR_FORMATTER } from '~/lib/labels/qr-format'
import type { BuyerOption } from '~/lib/labels/api'
import { FOUR_INCH_PRINT_WIDTH_MM } from '~/lib/labels/units'
import { Button } from '~/components/ui/button'
import { Input, Label, Select } from '~/components/ui/input'
import { cn } from '~/lib/utils'
import { NumberField } from './number-field'
import { useEditSession, type DesignerAction, type TemplateMeta } from './use-designer'

/** Which buyers a template prints for, as one select value. */
export function usedForValue(meta: TemplateMeta) {
  return meta.isDefault ? 'default' : (meta.customerId ?? 'none')
}
export function usedForPatch(value: string): Pick<TemplateMeta, 'customerId' | 'isDefault'> {
  if (value === 'default') return { customerId: null, isDefault: true }
  if (value === 'none') return { customerId: null, isDefault: false }
  return { customerId: value, isDefault: false }
}

export function UsedForSelect({
  id,
  value,
  buyers,
  onChange,
  describedBy,
}: {
  id: string
  value: string
  buyers: BuyerOption[]
  onChange: (v: string) => void
  describedBy?: string
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy}>
      <option value="default">Default (buyers without their own)</option>
      <option value="none">Not in use yet</option>
      <optgroup label="One buyer">
        {buyers.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.code})
          </option>
        ))}
      </optgroup>
    </Select>
  )
}

export function TemplateSettings({
  design,
  meta,
  buyers,
  dispatch,
}: {
  design: LabelDesign
  meta: TemplateMeta
  buyers: BuyerOption[]
  dispatch: React.Dispatch<DesignerAction>
}) {
  const preset = SIZE_PRESETS.find((p) => p.w === design.widthMm && p.h === design.heightMm)
  const nameSession = useEditSession('tpl-name')
  // Typing a size is one undo step per field focus (see NumberField).
  const setSize = (w: number, h: number, group: string) => dispatch({ type: 'size', widthMm: w, heightMm: h, group })
  const acrossHead = design.orientation === 'normal' ? design.widthMm : design.heightMm

  return (
    <section aria-labelledby="settings-title" className="grid gap-4">
      <h2 id="settings-title" className="text-lg font-bold">
        Template settings
      </h2>
      <p className="-mt-2 text-sm text-muted-foreground">Select something on the label to change it, or set up the whole template here.</p>

      <div className="grid gap-1">
        <Label htmlFor="tpl-name">Template name</Label>
        <Input
          id="tpl-name"
          value={meta.name}
          maxLength={80}
          onFocus={nameSession.onFocus}
          onChange={(e) => dispatch({ type: 'meta', patch: { name: e.target.value }, group: nameSession.group() })}
        />
      </div>

      <div className="grid gap-1">
        <Label htmlFor="tpl-used-for">Used for</Label>
        <UsedForSelect id="tpl-used-for" value={usedForValue(meta)} buyers={buyers} onChange={(v) => dispatch({ type: 'meta', patch: usedForPatch(v) })} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Label size</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {SIZE_PRESETS.map((p) => (
            <label
              key={p.id}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              )}
            >
              <input
                type="radio"
                name="size-preset"
                className="size-5 accent-accent"
                checked={preset?.id === p.id}
                onChange={() => {
                  // One undo step for the size and its matching printer feed.
                  dispatch({ type: 'checkpoint' })
                  dispatch({ type: 'size', widthMm: p.w, heightMm: p.h, record: false })
                  dispatch({ type: 'orientation', orientation: defaultOrientation(p.w, p.h), record: false })
                }}
              />
              <span>
                {p.label}
                {p.id === DEFAULT_SIZE.id && <span className="text-muted-foreground"> (default)</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField id="tpl-w" label="Width" unit="mm" value={design.widthMm} min={MIN_SIZE_MM} max={MAX_SIZE_MM} step={1} onChange={(v, g) => setSize(v, design.heightMm, g)} />
          <NumberField id="tpl-h" label="Height" unit="mm" value={design.heightMm} min={MIN_SIZE_MM} max={MAX_SIZE_MM} step={1} onChange={(v, g) => setSize(design.widthMm, v, g)} />
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Printer feed</legend>
        {(
          [
            ['normal', 'Top edge first', 'The label goes through the printer the way you read it.'],
            ['rotated', 'Sideways (rotated)', `For labels wider than a 4-inch printer (${FOUR_INCH_PRINT_WIDTH_MM} mm), such as 150 × 70 mm.`],
          ] as const
        ).map(([value, title, hint]) => (
          <label key={value} className="flex cursor-pointer items-start gap-2 rounded-md border bg-card p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input type="radio" name="orientation" className="mt-0.5 size-5 accent-accent" checked={design.orientation === value} onChange={() => dispatch({ type: 'orientation', orientation: value })} />
            <span className="grid text-sm">
              <span className="font-semibold">{title}</span>
              <span className="text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
        <p className="text-sm text-muted-foreground">
          Across the print head: {acrossHead} mm{acrossHead > FOUR_INCH_PRINT_WIDTH_MM ? ' (too wide for a 4-inch printer)' : ''}.
        </p>
      </fieldset>

      <div className="grid gap-2">
        <p className="text-sm font-semibold">Captions</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'captions', lang: 'en' })}>
            All in English
          </Button>
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'captions', lang: 'nl' })}>
            All in Dutch
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Fields set to "No caption" stay that way.</p>
      </div>

      <div className="grid gap-1 text-sm">
        <p className="font-semibold">QR code content</p>
        <p className="text-muted-foreground">{ACTIVE_QR_FORMATTER.name}. On the sample box:</p>
        <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">{ACTIVE_QR_FORMATTER.format(SAMPLE_LABEL_DATA)}</code>
      </div>
    </section>
  )
}
