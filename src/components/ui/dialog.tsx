import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '~/lib/utils'

/**
 * Modal dialog on the native <dialog> element: the browser traps focus, closes on Escape and
 * returns focus to where it was. Controlled with `open`.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const ref = React.useRef<HTMLDialogElement>(null)
  const id = React.useId()
  React.useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClose={onClose}
      className={cn('m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50', className)}
    >
      {open && (
        <div className="grid gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <h2 id={`${id}-title`} className="text-xl font-bold">
                {title}
              </h2>
              {description && (
                <div id={`${id}-desc`} className="text-sm text-muted-foreground">
                  {description}
                </div>
              )}
            </div>
            <button type="button" onClick={onClose} className="-m-1 inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-muted">
              <X className="size-5" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
