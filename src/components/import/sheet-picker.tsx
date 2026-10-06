import { CheckCircle2 } from 'lucide-react'
import { SHEETS, SHEET_ORDER, type SheetName } from '~/lib/import/schema'
import type { ParsedWorkbook } from '~/lib/import/parse'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'

/** One radio per sheet, in the order the template asks for. Sheets with no rows can't be picked. */
export function SheetPicker({
  workbook,
  value,
  onChange,
  importedThisSession,
}: {
  workbook: ParsedWorkbook
  value: SheetName | null
  onChange: (s: SheetName) => void
  importedThisSession: SheetName[]
}) {
  const rowCount = (name: SheetName) => workbook.sheets.find((s) => s.name === name)?.rows.length
  const suggested = SHEET_ORDER.find((s) => (rowCount(s) ?? 0) > 0 && !importedThisSession.includes(s))

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold">Sheet to import (listed in import order)</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SHEET_ORDER.map((name, i) => {
          const count = rowCount(name)
          const disabled = !count
          const done = importedThisSession.includes(name)
          return (
            <label
              key={name}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="sheet"
                value={name}
                checked={value === name}
                disabled={disabled}
                onChange={() => onChange(name)}
                className="mt-0.5 size-6 shrink-0 accent-accent"
              />
              <span className="grid flex-1 gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-bold">
                  {i + 1}. {name}
                  {done && (
                    <Badge variant="success">
                      <CheckCircle2 aria-hidden="true" /> Imported
                    </Badge>
                  )}
                  {!done && name === suggested && <Badge variant="outline">Next</Badge>}
                </span>
                <span className="text-sm text-muted-foreground">{SHEETS[name].description}</span>
                <span className="text-sm">
                  {count === undefined ? 'Not in this file' : count === 0 ? 'No rows filled in' : `${count} ${count === 1 ? 'row' : 'rows'}`}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
