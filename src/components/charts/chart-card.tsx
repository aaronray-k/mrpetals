import * as React from 'react'
import { Table2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export interface TableView {
  columns: string[]
  rows: (string | number)[][]
}

/** A chart with its title, and a "Show as table" switch so every value is readable without the chart. */
export function ChartCard({ title, description, table, children, empty }: { title: string; description?: string; table: TableView; children: React.ReactNode; empty?: string }) {
  const [asTable, setAsTable] = React.useState(false)
  const id = React.useId()
  const hasData = table.rows.length > 0
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="grid gap-1">
          <CardTitle className="text-lg" id={id}>
            {title}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {hasData && (
          <Button size="sm" variant="ghost" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
            <Table2 aria-hidden="true" /> {asTable ? 'Show chart' : 'Show as table'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-muted-foreground">{empty ?? 'Nothing in this period yet.'}</p>
        ) : asTable ? (
          <div className="rounded-md border">
            <Table aria-labelledby={id}>
              <THead>
                <TR>
                  {table.columns.map((c, i) => (
                    <TH key={c} className={i > 0 ? 'text-right' : undefined}>
                      {c}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {table.rows.map((r, i) => (
                  <TR key={i}>
                    {r.map((v, j) => (
                      <TD key={j} className={j > 0 ? 'text-right tabular-nums' : undefined}>
                        {typeof v === 'number' ? v.toLocaleString('en-GB') : v}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

/** "1,284", "12.9K", "1.2M": short numbers for axes and tiles. */
export function compact(n: number) {
  return new Intl.NumberFormat('en-GB', { notation: Math.abs(n) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(n) >= 10000 ? 1 : 2 }).format(n)
}

/** Clean axis maximum and ticks: 0, step, 2·step… */
export function niceTicks(max: number, count = 4) {
  if (max <= 0) return { top: 1, ticks: [0, 1] }
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const top = Math.ceil(max / step) * step
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) }
}
