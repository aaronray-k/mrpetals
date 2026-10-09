import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { applyPlan, planFromFile, saveCostingSettings, useCostingSettings } from '~/lib/master/api'
import type { ImportPlan } from '~/lib/master/plan'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { FileDrop } from '~/components/import/file-drop'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/master-import')({
  head: () => ({ meta: [{ title: 'Master price file · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/master-import')}>
      <MasterImport />
    </RequireRole>
  ),
})

const n = (x: number) => x.toLocaleString('en-GB')

function MasterImport() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [fileName, setFileName] = React.useState<string>()
  const [reading, setReading] = React.useState(false)
  const [plan, setPlan] = React.useState<ImportPlan | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [progress, setProgress] = React.useState<{ done: number; what: string } | null>(null)
  const [result, setResult] = React.useState<{ farms: number; varieties: number; prices: number } | null>(null)

  return (
    <>
      <PageHeader
        title="Master price file"
        description="Farms, varieties, farm prices, margins and pack rates from the master file. Every figure stays editable in ConsolFlora."
      />
      <div className="grid grid-cols-1 gap-4">
        <CostingCard fileRate={plan?.fileFreightPerKg ?? null} />
        <Card>
          <CardHeader>
            <CardTitle>1. Choose the master file</CardTitle>
            <CardDescription>
              Sheets with OFFER in the name are skipped, and so are farms given only as a code (XFL, ABL/BVL…). Nothing is saved until you press Import.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileDrop
              fileName={fileName}
              busy={reading}
              onFile={async (f) => {
                setFileName(f.name)
                setPlan(null)
                setResult(null)
                setError(null)
                setReading(true)
                try {
                  setPlan(await planFromFile(f))
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setReading(false)
                }
              }}
            />
            {error && (
              <Alert variant="destructive" title="Couldn't read the file" className="mt-4" role="alert">
                {error}
              </Alert>
            )}
          </CardContent>
        </Card>

        {plan && <PlanSummary plan={plan} />}

        {plan && (
          <Card>
            <CardHeader>
              <CardTitle>3. Import</CardTitle>
              <CardDescription>
                Farms already in ConsolFlora keep their details; prices are saved from today, so older orders keep theirs. Importing the same file again
                updates, never duplicates.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {progress && (
                <div className="grid gap-1" role="status">
                  <progress className="h-3 w-full accent-accent" value={progress.done} max={1} />
                  <span className="text-sm text-muted-foreground">{progress.what}</span>
                </div>
              )}
              {result && (
                <Alert variant="success" title="Imported">
                  {n(result.farms)} farms, {n(result.varieties)} varieties and {n(result.prices)} prices are in ConsolFlora.
                </Alert>
              )}
              <div>
                <Button
                  disabled={!!progress}
                  onClick={async () => {
                    setResult(null)
                    setProgress({ done: 0, what: 'Starting' })
                    try {
                      const r = await applyPlan(plan, (done, what) => setProgress({ done, what }))
                      setResult(r)
                      toast({ kind: 'success', title: 'Master file imported', description: `${n(r.prices)} prices saved.` })
                      void queryClient.invalidateQueries()
                    } catch (e) {
                      toast({ kind: 'error', title: 'Import stopped', description: `${(e as Error).message} What was saved stays; importing again carries on.` })
                    } finally {
                      setProgress(null)
                    }
                  }}
                >
                  <Upload aria-hidden="true" /> Import {n(plan.counts.prices)} prices
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

function PlanSummary({ plan }: { plan: ImportPlan }) {
  const [showAll, setShowAll] = React.useState(false)
  const growers = plan.farms.filter((f) => f.grower)
  const merged = plan.farms.filter((f) => f.spellings.length > 1)
  const photos = plan.varieties.filter((v) => v.photo)
  return (
    <Card>
      <CardHeader>
        <CardTitle>2. Check what will be imported</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Prices', plan.counts.prices],
            ['Farms', plan.farms.length],
            ['Webshop varieties', plan.varieties.length],
            ['With a catalogue photo', photos.length],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border p-3">
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="text-2xl font-bold tabular-nums">{n(v as number)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          Left out: {n(plan.counts.skipped)} rows with a farm code only or no price, {n(plan.counts.leftOut)} prices under placeholder names (FARM 1, 2, 3),
          and {n(plan.counts.duplicates)} repeated rows.
        </p>

        <section className="grid gap-2">
          <h3 className="font-semibold">Farms</h3>
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">Farms in the file</caption>
              <THead>
                <TR>
                  <TH>Farm</TH>
                  <TH>Grower</TH>
                  <TH>Names in the file</TH>
                  <TH className="text-right">Prices</TH>
                </TR>
              </THead>
              <TBody>
                {(showAll ? plan.farms : [...growers, ...merged.filter((f) => !f.grower)].slice(0, 40)).map((f) => (
                  <TR key={f.name}>
                    <TD className="font-semibold">{f.name}</TD>
                    <TD>{f.grower ?? ''}</TD>
                    <TD className="text-sm text-muted-foreground">{f.spellings.length > 1 ? f.spellings.join(', ') : ''}</TD>
                    <TD className="text-right tabular-nums">{n(plan.offers.filter((o) => o.farm === f.name).length)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <div>
            <Button variant="outline" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Only merged names and growers' : `Show all ${plan.farms.length} farms`}
            </Button>
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="font-semibold">Webshop varieties with a catalogue photo</h3>
          <p className="text-sm text-muted-foreground">One entry per variety, under the catalogue&apos;s name; spellings that share a photo are one variety.</p>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-8">
            {photos.slice(0, 24).map((v) => (
              <li key={v.key} className="grid justify-items-center gap-1 text-center text-sm">
                <img src={`/catalogue/${v.photo}`} alt="" loading="lazy" className="size-20 object-contain" />
                <span className="font-semibold">{v.name}</span>
                <span className="text-muted-foreground">
                  {v.flowerType} · {v.growers.length} {v.growers.length === 1 ? 'grower' : 'growers'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  )
}

/** The freight rate per kg everyone's costing uses; trucking to Madrid is kept but off for now. */
function CostingCard({ fileRate }: { fileRate: number | null }) {
  const settings = useCostingSettings()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [rate, setRate] = React.useState('')
  const [currency, setCurrency] = React.useState('USD')
  React.useEffect(() => {
    if (settings.data) {
      setRate(String(settings.data.freight_per_kg))
      setCurrency(settings.data.freight_currency)
    }
  }, [settings.data])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Freight rate</CardTitle>
        <CardDescription>
          From the freight agent; it changes. Freight per box = box weight × rate per kg; per stem = per box ÷ stems per box.
          {fileRate != null && settings.data && fileRate !== settings.data.freight_per_kg && (
            <> The master file uses {fileRate}; ConsolFlora uses the rate here.</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            const v = Number(rate)
            if (!Number.isFinite(v) || v < 0) return toast({ kind: 'error', title: 'Enter the rate per kg, e.g. 4.30' })
            try {
              await saveCostingSettings({ freight_per_kg: v, freight_currency: currency, trucking_enabled: false })
              toast({ kind: 'success', title: `Freight: ${currency} ${v.toFixed(2)} per kg` })
              void queryClient.invalidateQueries({ queryKey: ['costing-settings'] })
            } catch (err) {
              toast({ kind: 'error', title: 'Not saved', description: (err as Error).message })
            }
          }}
        >
          <Field id="freight-rate" label="Rate per kg">
            {(d) => <Input id="freight-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-describedby={d} className="w-32" />}
          </Field>
          <Field id="freight-currency" label="Currency">
            {(d) => (
              <Select id="freight-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-describedby={d}>
                {['USD', 'EUR', 'KES'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit">Save rate</Button>
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-muted-foreground opacity-60">
            <input type="checkbox" className="size-5" checked={false} disabled readOnly />
            Trucking to Madrid (off for now)
          </label>
          {settings.data && (
            <Badge variant="outline">Last changed {new Date(settings.data.updated_at).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</Badge>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
