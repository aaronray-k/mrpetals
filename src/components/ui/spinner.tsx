import { Loader2 } from 'lucide-react'
import { cn } from '~/lib/utils'

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}>
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span>{label}…</span>
    </span>
  )
}
