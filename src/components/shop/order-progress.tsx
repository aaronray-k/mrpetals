import { CheckCircle2, Circle, XCircle } from 'lucide-react'
import { progressSteps, type OrderProgress } from '~/lib/ordering/api'
import { Badge } from '~/components/ui/badge'

/** The buyer's view of where an order is: each step done (tick) or still to come (circle), in words. */
export function OrderTimeline({ progress }: { progress: OrderProgress }) {
  if (progress.status === 'declined' || progress.status === 'cancelled')
    return (
      <p className="flex items-start gap-2 font-semibold text-destructive">
        <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        Declined by ConsolFlora{progress.declined_reason ? `: ${progress.declined_reason}` : '.'}
      </p>
    )
  const steps = progressSteps(progress)
  return (
    <ol className="grid gap-2">
      {steps.map((s) => (
        <li key={s.id} className="flex items-center gap-2">
          {s.done ? <CheckCircle2 className="size-5 text-success" aria-hidden="true" /> : <Circle className="size-5 text-muted-foreground" aria-hidden="true" />}
          <span className={s.done ? 'font-semibold' : 'text-muted-foreground'}>{s.label}</span>
          <span className="sr-only">{s.done ? '(done)' : '(not yet)'}</span>
        </li>
      ))}
    </ol>
  )
}

/** One-word summary of the current step. */
export function OrderStage({ progress }: { progress: OrderProgress | null }) {
  if (!progress) return <Badge>Unknown</Badge>
  if (progress.status === 'declined' || progress.status === 'cancelled') return <Badge variant="destructive">Declined</Badge>
  const steps = progressSteps(progress)
  const next = steps.find((s) => !s.done)
  if (!next) return <Badge variant="success">Shipped</Badge>
  const last = [...steps].reverse().find((s) => s.done)!
  return <Badge variant={progress.status === 'submitted' ? 'warning' : 'default'}>{last.label.replace(/ \(.*\)$/, '')}</Badge>
}
