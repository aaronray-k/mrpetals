import * as React from 'react'
import { compact, niceTicks } from './chart-card'

export interface ColumnSeries {
  key: string
  label: string
  /** CSS colour; series 1 and 2 are the validated chart colours. */
  color: string
}

/**
 * Columns over time (weeks or months), one series or two stacked. Thin columns with rounded tops,
 * a 2px surface gap between stacked parts, hover/focus tooltip, and a legend when there are two series.
 * Each column is focusable and reads out its values, so the tooltip itself is hidden from screen readers.
 */
export function ColumnChart({
  data,
  series,
  format = compact,
  ariaLabel,
}: {
  data: { label: string; values: Record<string, number> }[]
  series: ColumnSeries[]
  format?: (n: number) => string
  ariaLabel: string
}) {
  const [hover, setHover] = React.useState<number | null>(null)
  const W = 640
  const H = 220
  const pad = { l: 48, r: 8, t: 12, b: 28 }
  const totals = data.map((d) => series.reduce((s, x) => s + Math.max(0, d.values[x.key] ?? 0), 0))
  const { top, ticks } = niceTicks(Math.max(...totals, 0))
  const innerW = W - pad.l - pad.r
  const innerH = H - pad.t - pad.b
  const band = innerW / Math.max(data.length, 1)
  const barW = Math.min(24, band * 0.6)
  const y = (v: number) => pad.t + innerH - (v / top) * innerH
  const every = Math.ceil(data.length / 8)

  return (
    <div className="grid gap-2">
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[11px]">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + band * i + (band - barW) / 2
            let base = 0
            return (
              <g
                key={d.label}
                tabIndex={0}
                role="img"
                aria-label={`${d.label}: ${series.map((s) => `${s.label} ${format(d.values[s.key] ?? 0)}`).join(', ')}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              >
                <rect x={pad.l + band * i} y={pad.t} width={band} height={innerH} fill={hover === i ? 'var(--chart-grid)' : 'transparent'} opacity={0.5} />
                {series.map((s, si) => {
                  const v = Math.max(0, d.values[s.key] ?? 0)
                  if (!v) return null
                  const y0 = y(base)
                  const y1 = y(base + v)
                  base += v
                  const isTop = series.slice(si + 1).every((n) => !(d.values[n.key] ?? 0))
                  const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0))
                  const r = isTop ? Math.min(4, h, barW / 2) : 0
                  // Rounded data-end on the top part only; square at the baseline.
                  return (
                    <path
                      key={s.key}
                      d={`M${x},${y0 - (si > 0 ? 2 : 0)} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0 - (si > 0 ? 2 : 0)} Z`}
                      fill={s.color}
                    />
                  )
                })}
                {i % every === 0 && (
                  <text x={pad.l + band * i + band / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                    {d.label}
                  </text>
                )}
              </g>
            )
          })}
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
        </svg>
        {hover != null && data[hover] && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md border bg-card px-3 py-2 text-sm shadow-md"
            style={{ left: `min(calc(${((pad.l + band * hover + band / 2) / W) * 100}% + 8px), calc(100% - 11rem))` }}
            aria-hidden="true"
          >
            <p className="font-semibold">{data[hover].label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                {s.label}: {format(data[hover]!.values[s.key] ?? 0)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
