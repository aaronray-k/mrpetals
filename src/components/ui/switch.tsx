import { cn } from '~/lib/utils'

/** Accessible on/off switch. The visible label is part of the button, so the whole row is the tap target. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn('inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-semibold', className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
          checked ? 'bg-accent' : 'bg-sidebar-muted/60',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </span>
      <span>
        {label}
        <span className="sr-only">{checked ? ' (on)' : ' (off)'}</span>
      </span>
    </button>
  )
}
