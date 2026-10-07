import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { LogOut, Menu, RotateCcw, X } from 'lucide-react'
import { useAuth } from '~/lib/auth'
import { ROLE_LABELS } from '~/lib/roles'
import { useTips } from '~/components/tips/tips'
import { Switch } from '~/components/ui/switch'
import { LegalFooter } from '~/components/legal/legal-footer'
import { cn } from '~/lib/utils'
import { navFor } from './nav'

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { roles } = useAuth()
  const { enabled: tipsOn } = useTips()
  const groups = navFor(roles)
  return (
    <nav aria-label="Main" className="grid gap-5">
      {groups.map((group) => (
        <div key={group.label} className="grid gap-1">
          <p className="px-3 text-xs font-bold tracking-wider text-sidebar-muted uppercase">{group.label}</p>
          <ul className="grid gap-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={onNavigate}
                  className="flex min-h-11 items-start gap-3 rounded-md px-3 py-2 text-sidebar-foreground hover:bg-sidebar-active"
                  activeProps={{ className: 'bg-sidebar-active font-bold', 'aria-current': 'page' }}
                >
                  <item.icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <span className="grid">
                    <span>{item.label}</span>
                    {tipsOn && <span className="text-xs font-normal text-sidebar-muted">{item.tip}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SidebarFooter() {
  const { profile, session, roles, signOut } = useAuth()
  const { enabled, setEnabled, resetDismissed } = useTips()
  return (
    <div className="grid gap-2 border-t border-white/10 pt-4">
      <Switch checked={enabled} onCheckedChange={setEnabled} label="Show tips" className="text-sidebar-foreground" />
      {enabled && (
        <button
          type="button"
          onClick={resetDismissed}
          className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-muted hover:text-sidebar-foreground"
        >
          <RotateCcw className="size-4" aria-hidden="true" /> Show hidden tips again
        </button>
      )}
      <div className="px-2 pt-2 text-sm">
        <p className="truncate font-semibold text-sidebar-foreground">{profile?.full_name || session?.user.email}</p>
        <p className="text-sidebar-muted">{roles.map((r) => ROLE_LABELS[r]).join(', ') || 'No role assigned'}</p>
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-semibold text-sidebar-foreground hover:bg-sidebar-active"
      >
        <LogOut className="size-4" aria-hidden="true" /> Sign out
      </button>
    </div>
  )
}

function Logo() {
  return (
    <Link to="/dashboard" className="block rounded-md">
      <img src="/consolflora-logo-dark.png" alt="ConsolFlora home" width={170} height={70} className="h-auto w-[170px]" />
    </Link>
  )
}

/** Mobile drawer built on <dialog>: the browser handles focus trapping, Escape and the backdrop. */
function MobileNav() {
  const ref = React.useRef<HTMLDialogElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const close = () => ref.current?.close()

  React.useEffect(close, [pathname])

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex size-11 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-active"
        aria-haspopup="dialog"
      >
        <Menu className="size-6" aria-hidden="true" />
        <span className="sr-only">Open menu</span>
      </button>
      <dialog
        ref={ref}
        aria-label="Menu"
        className="m-0 h-dvh max-h-none w-[min(20rem,88vw)] max-w-none bg-sidebar p-0 text-sidebar-foreground backdrop:bg-black/50"
        onClick={(e) => e.target === ref.current && close()}
      >
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between">
            <Logo />
            <button
              type="button"
              onClick={close}
              className="inline-flex size-11 items-center justify-center rounded-md hover:bg-sidebar-active"
            >
              <X className="size-6" aria-hidden="true" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <div className="flex-1">
            <NavList onNavigate={close} />
          </div>
          <SidebarFooter />
        </div>
      </dialog>
    </>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:font-bold"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 flex items-center justify-between bg-sidebar px-4 py-2 lg:hidden">
        <img src="/consolflora-logo-dark.png" alt="ConsolFlora" width={120} height={49} className="h-auto w-[120px]" />
        <MobileNav />
      </header>

      <aside className="hidden lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto bg-sidebar p-4">
          <Logo />
          <div className="flex-1">
            <NavList />
          </div>
          <SidebarFooter />
        </div>
      </aside>

      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col">
        <main id="main" tabIndex={-1} className="w-full min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:py-8">
          {children}
        </main>
        <LegalFooter className="mx-4 mb-6 border-t pt-4 sm:mx-6" />
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-primary dark:text-foreground">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
