import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '~/lib/auth'
import { navFor } from '~/components/layout/nav'
import { PageHeader } from '~/components/layout/app-shell'
import { Tip } from '~/components/tips/tips'
import { Card } from '~/components/ui/card'
import { QC_CLEAR_ROLES, QC_ROLES, hasAnyRole, type Role } from '~/lib/roles'
import { PERIODS, type DashboardKind } from '~/lib/dashboards/api'
import { BuyerDashboard, FarmDashboard, FinanceDashboard, QcDashboard, StaffDashboard } from '~/components/dashboard/dashboards'
import { cn } from '~/lib/utils'

const KINDS: { kind: DashboardKind; label: string; roles: Role[] }[] = [
  { kind: 'staff', label: 'Orders and farms', roles: ['admin', 'consolidator'] },
  { kind: 'finance', label: 'Finance', roles: ['admin', 'finance'] },
  { kind: 'qc', label: 'QC', roles: QC_ROLES.filter((r) => r !== 'admin' && r !== 'consolidator') },
  { kind: 'farm', label: 'My farm', roles: ['farm'] },
  { kind: 'buyer', label: 'My orders', roles: ['customer'] },
]

function remembered<T extends string | number>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : ((typeof fallback === 'number' ? Number(v) : v) as T)
  } catch {
    return fallback
  }
}
function remember(key: string, value: string | number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* not remembered; fine */
  }
}

export const Route = createFileRoute('/_app/dashboard')({
  head: () => ({ meta: [{ title: 'Dashboard · ConsolFlora' }] }),
  component: Dashboard,
})

function Dashboard() {
  const { profile, session, roles } = useAuth()
  const name = profile?.full_name?.split(' ')[0] || session?.user.email
  const shortcuts = navFor(roles)
    .flatMap((g) => g.items)
    .filter((i) => i.to !== '/dashboard')

  const kinds = KINDS.filter((k) => hasAnyRole(roles, k.roles))
  const [kind, setKind] = React.useState<DashboardKind | null>(() => remembered<string>('dashboard.kind', '') as DashboardKind)
  const [weeks, setWeeks] = React.useState<number>(() => remembered<number>('dashboard.weeks', 8))
  const active = kinds.find((k) => k.kind === kind)?.kind ?? kinds[0]?.kind

  return (
    <>
      <PageHeader title={`Welcome, ${name}`} description="What needs doing, and how things are going." />

      <div className="grid grid-cols-1 gap-4">
        {active && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {kinds.length > 1 ? (
              <div role="tablist" aria-label="Dashboard" className="flex flex-wrap gap-1">
                {kinds.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    role="tab"
                    aria-selected={active === k.kind}
                    onClick={() => {
                      setKind(k.kind)
                      remember('dashboard.kind', k.kind)
                    }}
                    className={cn('inline-flex h-10 items-center rounded-md border px-4 font-semibold', active === k.kind ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            <fieldset className="flex gap-1 rounded-md border border-input bg-card p-1">
              <legend className="sr-only">Period</legend>
              {PERIODS.map((p) => (
                <label key={p.weeks} className={cn('inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', weeks === p.weeks && 'bg-accent/20')}>
                  <input
                    type="radio"
                    name="dashboard-period"
                    className="sr-only"
                    checked={weeks === p.weeks}
                    onChange={() => {
                      setWeeks(p.weeks)
                      remember('dashboard.weeks', p.weeks)
                    }}
                  />
                  {p.label}
                </label>
              ))}
            </fieldset>
          </div>
        )}
        <div role={kinds.length > 1 ? 'tabpanel' : undefined} aria-label={kinds.find((k) => k.kind === active)?.label}>
          {active === 'staff' && <StaffDashboard weeks={weeks} />}
          {active === 'finance' && <FinanceDashboard weeks={weeks} />}
          {active === 'qc' && <QcDashboard weeks={weeks} canClear={hasAnyRole(roles, QC_CLEAR_ROLES)} />}
          {active === 'farm' && <FarmDashboard weeks={weeks} />}
          {active === 'buyer' && <BuyerDashboard weeks={weeks} />}
        </div>

        <Tip id="dashboard.welcome" title="Finding your way around">
          The menu on the left (or the <strong>menu button</strong> at the top on a phone) lists everything your role can
          use. Each item has a short hint under it. You can switch these hints off with <strong>Show tips</strong> at the
          bottom of the menu.
        </Tip>

        {hasAnyRole(roles, ['admin', 'consolidator']) && (
          <Tip id="dashboard.import-order" title="Setting up for the first time?">
            Load your data with the <Link to="/import" className="font-semibold underline">Import page</Link>. Import the
            sheets in this order: Lists, Farms, Customers, BoxTypes, Products, PackRates, PriceList, FreightRates,
            PackingList.
          </Tip>
        )}

        {roles.length === 0 && (
          <Card className="p-5">
            <p className="font-bold">Your account has no role yet</p>
            <p className="text-muted-foreground">Ask a ConsolFlora Admin to give you access.</p>
          </Card>
        )}

        <h2 className="mt-2 text-xl font-bold">All your pages</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="group flex h-full items-start gap-3 rounded-lg border bg-card p-5 shadow-sm transition-colors hover:border-accent"
              >
                <span className="rounded-md bg-muted p-2 text-primary dark:text-accent">
                  <item.icon className="size-5" aria-hidden="true" />
                </span>
                <span className="grid flex-1 gap-0.5">
                  <span className="font-bold">{item.label}</span>
                  <span className="text-sm text-muted-foreground">{item.tip}</span>
                </span>
                <ArrowRight className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
