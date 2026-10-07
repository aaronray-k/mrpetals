import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

export interface ActionItem {
  key: string
  title: React.ReactNode
  detail?: React.ReactNode
  /** Where the work is done. */
  to?: string
  params?: Record<string, string>
  search?: Record<string, unknown>
  urgent?: boolean
}

/** One group of things to do; each item opens the page where it's done. */
export function ActionGroup({ title, items, empty }: { title: string; items: ActionItem[]; empty: string }) {
  return (
    <section aria-label={title} className="grid content-start gap-1">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        {title}
        <span className={`rounded-full px-2 text-xs ${items.length ? 'bg-warning-bg text-warning' : 'bg-muted text-muted-foreground'}`}>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> {empty}
        </p>
      ) : (
        <ul className="grid divide-y rounded-md border">
          {items.slice(0, 8).map((it) => {
            const body = (
              <>
                <span className="grid min-w-0 flex-1">
                  <span className={`truncate font-semibold ${it.urgent ? 'text-destructive' : ''}`}>{it.title}</span>
                  {it.detail && <span className="truncate text-sm text-muted-foreground">{it.detail}</span>}
                </span>
                {it.to && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </>
            )
            return (
              <li key={it.key}>
                {it.to ? (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <Link to={it.to as any} params={it.params as any} search={it.search as any} className="flex min-h-11 items-center gap-2 px-3 py-2 hover:bg-muted">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-11 items-center gap-2 px-3 py-2">{body}</div>
                )}
              </li>
            )
          })}
          {items.length > 8 && <li className="px-3 py-2 text-sm text-muted-foreground">and {items.length - 8} more</li>}
        </ul>
      )}
    </section>
  )
}

export function ActionsCard({ children, total }: { children: React.ReactNode; total: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Needs your action {total > 0 && <span className="text-warning">({total})</span>}</CardTitle>
      </CardHeader>
      <CardContent className="grid items-start gap-4 md:grid-cols-2">{children}</CardContent>
    </Card>
  )
}
