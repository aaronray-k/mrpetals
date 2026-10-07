import { compact } from './chart-card'

/**
 * Horizontal bars for comparing named things (farms, reasons, buyers). A bar can sit on a lighter
 * "out of" track (fill rate: confirmed of asked) and carry a limit marker (credit limit). The value
 * is written as text beside the bar, so nothing depends on colour.
 */
export function BarList({
  rows,
  format = compact,
  color = 'var(--series-1)',
}: {
  rows: { label: string; value: number; of?: number; limit?: number; note?: string; warn?: boolean }[]
  format?: (n: number) => string
  color?: string
}) {
  const max = Math.max(...rows.map((r) => Math.max(r.value, r.of ?? 0, r.limit ?? 0)), 1)
  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.label} className="grid gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">{r.label}</span>
            <span className={`tabular-nums ${r.warn ? 'font-semibold text-warning' : ''}`}>
              {r.note ?? (r.of != null ? `${format(r.value)} of ${format(r.of)}` : format(r.value))}
            </span>
          </div>
          <div className="relative h-3" aria-hidden="true">
            {r.of != null && <div className="absolute inset-y-0 left-0 rounded-sm bg-chart-grid" style={{ width: `${(r.of / max) * 100}%` }} />}
            <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${(Math.max(0, r.value) / max) * 100}%`, background: color }} />
            {r.limit != null && <div className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `${(r.limit / max) * 100}%` }} />}
          </div>
        </li>
      ))}
    </ul>
  )
}
