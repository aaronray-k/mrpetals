import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { saveOrderingSettings, useOrderingSettings } from '~/lib/ordering/api'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { formatDate } from '~/components/orders/shipment-status'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/settings/ordering')({
  head: () => ({ meta: [{ title: 'Ordering settings · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/settings/ordering')}>
      <OrderingSettingsPage />
    </RequireRole>
  ),
})

function OrderingSettingsPage() {
  const q = useOrderingSettings()
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <Alert variant="destructive" title="Couldn't load the settings" role="alert" />
  return <SettingsForm key={JSON.stringify(q.data)} settings={q.data} />
}

function SettingsForm({ settings }: { settings: NonNullable<ReturnType<typeof useOrderingSettings>['data']> }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [lead, setLead] = React.useState(String(settings.min_lead_hours))
  const [farm, setFarm] = React.useState(String(settings.farm_delivery_hours))
  const [ahead, setAhead] = React.useState(String(settings.standing_order_days_ahead))
  const [claims, setClaims] = React.useState(String(settings.claim_window_hours))
  const [error, setError] = React.useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const v = { min_lead_hours: Number(lead), farm_delivery_hours: Number(farm), standing_order_days_ahead: Number(ahead), claim_window_hours: Number(claims) }
    if (!Number.isInteger(v.min_lead_hours) || v.min_lead_hours < 0 || v.min_lead_hours > 720) return setError('Lead time: a whole number of hours, 0 to 720.')
    if (!Number.isInteger(v.farm_delivery_hours) || v.farm_delivery_hours < 0 || v.farm_delivery_hours > 336) return setError('Farm delivery: a whole number of hours, 0 to 336.')
    if (!Number.isInteger(v.standing_order_days_ahead) || v.standing_order_days_ahead < 1 || v.standing_order_days_ahead > 30) return setError('Standing orders: 1 to 30 days.')
    if (!Number.isInteger(v.claim_window_hours) || v.claim_window_hours < 1 || v.claim_window_hours > 720) return setError('Claim window: a whole number of hours, 1 to 720.')
    setError(null)
    try {
      await saveOrderingSettings(v)
      toast({ kind: 'success', title: 'Ordering settings saved' })
      void queryClient.invalidateQueries({ queryKey: ['ordering-settings'] })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <PageHeader title="Ordering settings" description="Timing rules for buyer orders and claims. Changes apply straight away." />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={save} noValidate className="grid gap-4 sm:max-w-xl">
            {error && <Alert variant="destructive" title={error} role="alert" />}
            <Field id="lead" label="Order lead time (hours)" hint={`An order must be placed this long before the end of its ship date. Earliest ship date today: ${formatDate(settings.earliest_ship_date)}.`}>
              {(d) => <Input id="lead" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="farm" label="Farm delivery before the flight (hours)" hint="Farms deliver this long before the ship date; rounded up to whole days.">
              {(d) => <Input id="farm" inputMode="numeric" value={farm} onChange={(e) => setFarm(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="ahead" label="Standing orders: create each week's order (days before shipping)">
              {(d) => <Input id="ahead" inputMode="numeric" value={ahead} onChange={(e) => setAhead(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="claims" label="Claim window after the flight lands (hours)" hint="Buyers can report problems with a shipment for this long after it arrives.">
              {(d) => <Input id="claims" inputMode="numeric" value={claims} onChange={(e) => setClaims(e.target.value)} aria-describedby={d} />}
            </Field>
            <div>
              <Button type="submit">Save settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
