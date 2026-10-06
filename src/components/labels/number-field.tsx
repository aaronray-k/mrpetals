import * as React from 'react'
import { Input, Label } from '~/components/ui/input'
import { useEditSession } from './use-designer'

/**
 * Number input in mm or pt. Live-updates the label while typing; each focus of the field
 * is one edit session, which the designer turns into a single undo step.
 */
export function NumberField({
  id,
  label,
  unit,
  value,
  min,
  max,
  step = 0.5,
  onChange,
}: {
  id: string
  label: string
  unit: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number, group: string) => void
}) {
  const session = useEditSession(id)
  const [text, setText] = React.useState(String(value))
  const focused = React.useRef(false)
  React.useEffect(() => {
    if (!focused.current) setText(String(Math.round(value * 10) / 10))
  }, [value])

  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>
        {label} <span className="font-normal text-muted-foreground">({unit})</span>
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        onFocus={() => {
          focused.current = true
          session.onFocus()
        }}
        onBlur={() => {
          focused.current = false
          setText(String(Math.round(value * 10) / 10))
        }}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n, session.group())
        }}
      />
    </div>
  )
}
