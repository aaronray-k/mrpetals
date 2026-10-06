import * as React from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '~/lib/utils'

type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  title: string
  description?: string
  /** false: announce to screen readers only, when the change is already visible on the page. */
  visual?: boolean
}

const ToastContext = React.createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

/**
 * Visible toasts plus two permanent live regions. Messages are written into the
 * regions so screen readers announce them (WCAG 4.1.3 Status Messages); errors
 * use the assertive region.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const [polite, setPolite] = React.useState('')
  const [assertive, setAssertive] = React.useState('')
  const nextId = React.useRef(1)

  const dismiss = React.useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  const push = React.useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId.current++
      if (t.visual !== false) setToasts((ts) => [...ts.slice(-1), { ...t, id }])
      const text = t.description ? `${t.title}. ${t.description}` : t.title
      if (t.kind === 'error') setAssertive(text)
      else setPolite(text)
      window.setTimeout(() => dismiss(id), t.kind === 'error' ? 10000 : 6000)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? XCircle : Info
          return (
            <div
              key={t.id}
              aria-hidden="true"
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-card p-4 shadow-lg',
                t.kind === 'error' && 'border-destructive/50',
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 size-5 shrink-0',
                  t.kind === 'success' && 'text-success',
                  t.kind === 'error' && 'text-destructive',
                )}
              />
              <div className="grid flex-1 gap-0.5">
                <p className="font-bold">{t.title}</p>
                {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-m-1 inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                tabIndex={-1}
              >
                <X className="size-4" />
                <span className="sr-only">Dismiss</span>
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return React.useContext(ToastContext)
}
