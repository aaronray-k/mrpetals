import * as React from 'react'
import { Lightbulb, X } from 'lucide-react'
import { useAuth } from '~/lib/auth'
import { getSupabase } from '~/lib/supabase'
import { cn } from '~/lib/utils'

const ENABLED_KEY = 'cf.tips.enabled'
const DISMISSED_KEY = 'cf.tips.dismissed'

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or blocked storage: the setting just won't survive a reload.
  }
}

interface TipsState {
  enabled: boolean
  setEnabled: (on: boolean) => void
  isDismissed: (id: string) => boolean
  dismiss: (id: string) => void
  resetDismissed: () => void
}

const TipsContext = React.createContext<TipsState | null>(null)

/**
 * Navigation and page tips. The on/off choice is saved on the user's profile
 * (profiles.show_tips) so it follows them across devices; individually
 * dismissed tips are remembered in this browser.
 */
export function TipsProvider({ children }: { children: React.ReactNode }) {
  const { profile, session } = useAuth()
  const [enabled, setEnabledState] = React.useState(true)
  const [dismissed, setDismissed] = React.useState<string[]>([])

  React.useEffect(() => {
    setEnabledState(readLocal(ENABLED_KEY, true))
    setDismissed(readLocal<string[]>(DISMISSED_KEY, []))
  }, [])

  React.useEffect(() => {
    if (profile) {
      setEnabledState(profile.show_tips)
      writeLocal(ENABLED_KEY, profile.show_tips)
    }
  }, [profile])

  const value = React.useMemo<TipsState>(
    () => ({
      enabled,
      setEnabled: (on) => {
        setEnabledState(on)
        writeLocal(ENABLED_KEY, on)
        if (session) void getSupabase().from('profiles').update({ show_tips: on }).eq('id', session.user.id)
      },
      isDismissed: (id) => dismissed.includes(id),
      dismiss: (id) => {
        setDismissed((d) => {
          const next = [...new Set([...d, id])]
          writeLocal(DISMISSED_KEY, next)
          return next
        })
      },
      resetDismissed: () => {
        setDismissed([])
        writeLocal(DISMISSED_KEY, [])
      },
    }),
    [enabled, dismissed, session],
  )

  return <TipsContext.Provider value={value}>{children}</TipsContext.Provider>
}

export function useTips() {
  const ctx = React.useContext(TipsContext)
  if (!ctx) throw new Error('useTips must be used inside TipsProvider')
  return ctx
}

/** A dismissible hint box. Hidden when tips are switched off or this tip was dismissed. */
export function Tip({
  id,
  title,
  children,
  className,
}: {
  id: string
  title: string
  children: React.ReactNode
  className?: string
}) {
  const { enabled, isDismissed, dismiss } = useTips()
  if (!enabled || isDismissed(id)) return null
  return (
    <aside
      aria-label={`Tip: ${title}`}
      className={cn('flex gap-3 rounded-lg border border-accent/40 bg-info-bg p-4', className)}
    >
      <Lightbulb className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
      <div className="grid flex-1 gap-1 text-sm">
        <p className="font-bold">
          <span className="sr-only">Tip: </span>
          {title}
        </p>
        <div className="text-muted-foreground [&_strong]:text-foreground">{children}</div>
      </div>
      <button
        type="button"
        onClick={() => dismiss(id)}
        className="-m-1 inline-flex h-9 shrink-0 items-center gap-1 self-start rounded-md px-2 text-sm font-semibold hover:bg-muted"
      >
        <X className="size-4" aria-hidden="true" />
        Got it<span className="sr-only">, hide this tip</span>
      </button>
    </aside>
  )
}
