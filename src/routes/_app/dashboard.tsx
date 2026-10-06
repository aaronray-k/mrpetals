import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '~/lib/auth'
import { navFor } from '~/components/layout/nav'
import { PageHeader } from '~/components/layout/app-shell'
import { Tip } from '~/components/tips/tips'
import { Card } from '~/components/ui/card'
import { hasAnyRole } from '~/lib/roles'

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

  return (
    <>
      <PageHeader title={`Welcome, ${name}`} description="Pick up where you left off." />

      <div className="grid grid-cols-1 gap-4">
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
