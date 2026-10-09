import * as React from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import type { Box } from '~/lib/orders/api'
import { cn } from '~/lib/utils'
import { boxNumber } from '~/components/orders/status'
import { QcBadge } from './qc-badge'

type Filter = 'all' | 'todo' | 'flagged'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'Not scanned' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'all', label: 'All' },
]

/** The shipment's boxes, one row each, grouped by buyer and farm, ticked once scanned. */
export function BoxChecklist({
  boxes,
  buyerName,
  farmName,
  productName,
  currentId,
  onPick,
}: {
  boxes: Box[]
  buyerName: (id: string) => string
  farmName: (id: string) => string
  productName: (id: string) => string
  currentId: number | null
  onPick: (box: Box) => void
}) {
  const [filter, setFilter] = React.useState<Filter>('todo')
  const live = boxes.filter((b) => b.status !== 'void')
  const flagged = (b: Box) => b.status === 'back_to_farm' || b.qc_status === 'failed' || b.qc_severity === 'minor'
  const shown = live.filter((b) => (filter === 'todo' ? !b.scanned && b.status === 'active' : filter === 'flagged' ? flagged(b) : true))
  const buyers = [...new Set(live.map((b) => b.customer_id))]

  return (
    <section aria-labelledby="checklist-title" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="checklist-title" className="text-xl font-bold">
          Packing list
        </h2>
        <fieldset className="flex gap-1 rounded-md border border-input bg-card p-1">
          <legend className="sr-only">Show</legend>
          {FILTERS.map((f) => (
            <label key={f.id} className={cn('inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', filter === f.id && 'bg-accent/20')}>
              <input type="radio" name="checklist-filter" className="sr-only" checked={filter === f.id} onChange={() => setFilter(f.id)} />
              {f.label}
            </label>
          ))}
        </fieldset>
      </div>

      {live.length === 0 && (
        <p className="text-muted-foreground">No boxes on this shipment yet. Boxes appear once staff assign them to confirmed farm POs.</p>
      )}
      {buyers.map((buyerId) => {
        const mine = live.filter((b) => b.customer_id === buyerId && b.status === 'active')
        const scanned = mine.filter((b) => b.scanned).length
        const rows = shown.filter((b) => b.customer_id === buyerId)
        const farms = [...new Set(rows.map((b) => b.farm_id))]
        return (
          <div key={buyerId} className="grid gap-2">
            <p className="font-bold" role="status">
              {buyerName(buyerId)}: {scanned} of {mine.length} scanned
            </p>
            {rows.length === 0 && <p className="text-sm text-muted-foreground">{filter === 'todo' ? 'Every box is scanned.' : 'Nothing to show.'}</p>}
            {farms.map((farmId) => (
              <div key={farmId} className="grid gap-1">
                <p className="text-sm font-semibold text-muted-foreground">{farmName(farmId)}</p>
                <ul className="grid divide-y rounded-lg border bg-card">
                  {rows
                    .filter((b) => b.farm_id === farmId)
                    .map((b) => (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => onPick(b)}
                          aria-current={b.id === currentId ? 'true' : undefined}
                          className={cn('grid min-h-12 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-muted', b.id === currentId && 'bg-accent/10')}
                        >
                          {b.scanned ? (
                            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
                          ) : (
                            <Circle className="size-5 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-bold tabular-nums">{b.status === 'back_to_farm' ? 'Back to farm' : boxNumber(b.buyer_box_no, b.buyer_box_total)}</span>
                            <span className="text-sm">
                              {productName(b.product_id)} · {b.stems} stems
                            </span>
                            <span className="text-sm font-semibold">{b.scanned ? 'Scanned' : 'Not scanned'}</span>
                            <QcBadge box={b} />
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )
      })}
    </section>
  )
}
