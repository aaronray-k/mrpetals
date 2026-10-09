import { AlignCenter, AlignLeft, AlignRight, Lock, Trash2 } from 'lucide-react'
import { FIELD_GROUPS, LABEL_FIELDS, fieldDef, type FieldKey } from '~/lib/labels/fields'
import { elementName, isLocked, isTextLike, type Align, type LabelElement } from '~/lib/labels/layout'
import { ACTIVE_QR_FORMATTER } from '~/lib/labels/qr-format'
import { Button } from '~/components/ui/button'
import { Label, Select } from '~/components/ui/input'
import { cn } from '~/lib/utils'
import { NumberField } from './number-field'
import { useEditSession, type DesignerAction } from './use-designer'

const ALIGNS: { value: Align; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Left', Icon: AlignLeft },
  { value: 'center', label: 'Centre', Icon: AlignCenter },
  { value: 'right', label: 'Right', Icon: AlignRight },
]

/** Settings for the selected element. */
export function Inspector({
  element: el,
  widthMm,
  heightMm,
  dispatch,
}: {
  element: LabelElement
  widthMm: number
  heightMm: number
  dispatch: React.Dispatch<DesignerAction>
}) {
  const update = (patch: Partial<LabelElement>, group?: string) => dispatch({ type: 'update', id: el.id, patch, group })
  const textSession = useEditSession(`el-${el.id}-text`)
  const locked = isLocked(el)
  const fieldId = (name: string) => `el-${el.id}-${name}`

  return (
    <section aria-labelledby="inspector-title" className="grid gap-4">
      <div className="flex items-start justify-between gap-2">
        <h2 id="inspector-title" className="text-lg font-bold">
          {elementName(el)}
        </h2>
        {!locked && (
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'remove', id: el.id })}>
            <Trash2 aria-hidden="true" /> Remove
          </Button>
        )}
      </div>
      {locked && (
        <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {el.type === 'reprint'
            ? 'Where the REPRINT mark goes. It prints on reprints only, so keep it clear of the QR code.'
            : 'Always on the label. You can move and resize it, but not remove it.'}
        </p>
      )}

      {el.type === 'field' && (
        <div className="grid gap-1">
          <Label htmlFor={fieldId('field')}>Field</Label>
          <Select id={fieldId('field')} value={el.field} onChange={(e) => update({ field: e.target.value as FieldKey })}>
            {FIELD_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {LABEL_FIELDS.filter((f) => f.group === g).map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.en}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      )}

      {el.type === 'text' && (
        <div className="grid gap-1">
          <Label htmlFor={fieldId('text')}>Text</Label>
          <textarea
            id={fieldId('text')}
            maxLength={200}
            rows={2}
            value={el.text}
            onFocus={textSession.onFocus}
            onChange={(e) => update({ text: e.target.value }, textSession.group())}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-base"
          />
        </div>
      )}

      {(el.type === 'field' || el.type === 'box_id') && (
        <div className="grid gap-1">
          <Label htmlFor={fieldId('caption')}>Caption</Label>
          <Select id={fieldId('caption')} value={el.caption} onChange={(e) => update({ caption: e.target.value as 'en' | 'nl' | 'none' })}>
            <option value="en">English{el.type === 'field' ? ` ("${fieldDef(el.field)?.en}:")` : ' ("Box ID:")'}</option>
            <option value="nl">Dutch{el.type === 'field' ? ` ("${fieldDef(el.field)?.nl}:")` : ' ("Doos-ID:")'}</option>
            <option value="none">No caption</option>
          </Select>
        </div>
      )}

      {el.type === 'box_count' && (
        <>
          <div className="grid gap-1">
            <Label htmlFor={fieldId('style')}>Style</Label>
            <Select id={fieldId('style')} value={el.style} onChange={(e) => update({ style: e.target.value as 'words' | 'numbers' })}>
              <option value="words">Words ("Box 42 of 180")</option>
              <option value="numbers">Numbers ("042 / 180")</option>
            </Select>
          </div>
          {el.style === 'words' && (
            <div className="grid gap-1">
              <Label htmlFor={fieldId('lang')}>Language</Label>
              <Select id={fieldId('lang')} value={el.caption} onChange={(e) => update({ caption: e.target.value as 'en' | 'nl' })}>
                <option value="en">English ("Box 42 of 180")</option>
                <option value="nl">Dutch ("Doos 42 van 180")</option>
              </Select>
            </div>
          )}
        </>
      )}

      {el.type === 'logo' && (
        <div className="grid gap-1">
          <Label htmlFor={fieldId('variant')}>Logo</Label>
          <Select id={fieldId('variant')} value={el.variant} onChange={(e) => update({ variant: e.target.value as 'full' | 'mark' })}>
            <option value="full">Full ConsolFlora logo</option>
            <option value="mark">Logo mark only</option>
          </Select>
        </div>
      )}

      {el.type === 'qr' && (
        <div className="grid gap-1 text-sm">
          <p className="font-semibold">QR content</p>
          <p className="text-muted-foreground">{ACTIVE_QR_FORMATTER.name}</p>
        </div>
      )}

      {isTextLike(el) && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField id={fieldId('font')} label="Font size" unit="pt" value={el.fontPt} min={4} max={96} step={1} onChange={(v, g) => update({ fontPt: v }, g)} />
          <div className="grid gap-1">
            <span className="text-sm font-semibold" id={fieldId('weight-label')}>
              Weight
            </span>
            <label className="inline-flex h-10 items-center gap-2 text-base">
              <input type="checkbox" className="size-6 accent-accent" checked={el.bold} onChange={(e) => update({ bold: e.target.checked })} />
              Bold
            </label>
          </div>
          <div className="col-span-2 grid gap-1" role="group" aria-labelledby={fieldId('align-label')}>
            <span id={fieldId('align-label')} className="text-sm font-semibold">
              Alignment
            </span>
            <div className="flex gap-1">
              {ALIGNS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={el.align === value}
                  onClick={() => update({ align: value })}
                  className={cn(
                    'inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border text-sm font-semibold',
                    el.align === value ? 'border-accent bg-accent/15' : 'border-input bg-card hover:bg-muted',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-1 text-sm font-semibold">Position and size</legend>
        <NumberField id={fieldId('x')} label="From left" unit="mm" value={el.x} min={0} max={widthMm} onChange={(v, g) => update({ x: v }, g)} />
        <NumberField id={fieldId('y')} label="From top" unit="mm" value={el.y} min={0} max={heightMm} onChange={(v, g) => update({ y: v }, g)} />
        {el.type === 'qr' ? (
          <NumberField id={fieldId('size')} label="Size" unit="mm" value={el.w} min={5} max={Math.min(widthMm, heightMm)} onChange={(v, g) => update({ w: v }, g)} />
        ) : (
          <>
            <NumberField id={fieldId('w')} label="Width" unit="mm" value={el.w} min={2} max={widthMm} onChange={(v, g) => update({ w: v }, g)} />
            {el.type !== 'logo' && (
              <NumberField id={fieldId('h')} label="Height" unit="mm" value={el.h} min={2} max={heightMm} onChange={(v, g) => update({ h: v }, g)} />
            )}
          </>
        )}
      </fieldset>
    </section>
  )
}
