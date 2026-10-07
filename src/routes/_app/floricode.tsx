import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search } from 'lucide-react'
import { useAuth } from '~/lib/auth'
import { hasAnyRole } from '~/lib/roles'
import { formatDateTime } from '~/lib/utils'
import {
  runFloricodeSync,
  useFloricode,
  useFloricodeCompanies,
  useFloricodeSource,
  useSyncRuns,
  type SyncRun,
} from '~/lib/floricode/api'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { CodeStatusBadge } from '~/components/floricode/code-status'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input, Label } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/_app/floricode')({
  head: () => ({ meta: [{ title: 'Floricode · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/floricode')}>
      <FloricodePage />
    </RequireRole>
  ),
})

const SOURCE_LABEL = { demo: 'Demo data (as if from the Floricode API)', api: 'Floricode API', none: 'Not connected' } as const

function FloricodePage() {
  return (
    <>
      <PageHeader title="Floricode" description="Floricode's codes for products, features, packaging and companies, kept in step with Floricode." />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="floricode.how" title="How the codes are used">
          Products take their VBN code, stem length, head size, ripeness and quality group from these lists. Box types take their packaging
          code. The codes go on the box label and into its QR code. When Floricode blocks or changes a code, the products using it are flagged
          on the <Link to="/products" className="font-semibold underline">Products</Link> page.
        </Tip>
        <SyncCard />
        <CodesBrowser />
      </div>
    </>
  )
}

function SyncCard() {
  const { roles } = useAuth()
  const isAdmin = hasAnyRole(roles, ['admin'])
  const source = useFloricodeSource()
  const runs = useSyncRuns()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  const lastOk = runs.data?.find((r) => r.status === 'ok')
  const latest = runs.data?.[0]
  const src = source.data?.source

  async function sync() {
    setBusy(true)
    try {
      const r = await runFloricodeSync()
      toast({
        kind: 'success',
        title: 'Floricode synced',
        description: `${r.changes} ${r.changes === 1 ? 'change' : 'changes'} from Floricode; ${r.flagged} ${r.flagged === 1 ? 'product' : 'products'} newly flagged for review.`,
      })
    } catch (e) {
      toast({ kind: 'error', title: 'Sync failed', description: (e as Error).message })
    } finally {
      setBusy(false)
      for (const k of ['floricode', 'floricode-runs', 'floricode-companies', 'product-reviews', 'products-floricode']) void queryClient.invalidateQueries({ queryKey: [k] })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Sync</CardTitle>
            <CardDescription>Source: {src ? SOURCE_LABEL[src] : '…'}</CardDescription>
          </div>
          {isAdmin && (
            <Button onClick={sync} disabled={busy || src === 'none'}>
              <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden="true" /> {busy ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {src === 'none' && (
          <Alert title="Floricode is not connected">
            Add FLORICODE_API_URL and FLORICODE_API_KEY to the server environment once ConsolFlora has its Floricode account. Until then products
            can't take codes from the lists.
          </Alert>
        )}
        {src === 'demo' && (
          <p className="text-sm text-muted-foreground">
            This preview uses demo master data shaped like Floricode's. The codes are examples, not real Floricode codes.
          </p>
        )}
        {runs.isLoading && <Spinner />}
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Last successful sync</dt>
            <dd className="font-semibold">{lastOk?.finished_at ? formatDateTime(lastOk.finished_at) : 'Never'}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd>{latest ? <RunStatus run={latest} /> : 'Not synced yet'}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Codes held</dt>
            <dd className="font-semibold">
              {lastOk
                ? `${lastOk.counts.products ?? 0} products · ${lastOk.counts.feature_values ?? 0} feature values · ${lastOk.counts.packaging ?? 0} packaging · ${lastOk.counts.companies ?? 0} companies`
                : '—'}
            </dd>
          </div>
        </dl>
        {latest?.status === 'failed' && latest.message && (
          <Alert variant="destructive" title="The last sync failed">
            {latest.message}
          </Alert>
        )}
        {lastOk && lastOk.changes.length > 0 && (
          <div className="grid gap-1">
            <p className="text-sm font-semibold">Changes in the last sync</p>
            <ul className="grid list-disc gap-1 pl-5 text-sm">
              {lastOk.changes.map((c, i) => (
                <li key={i}>{c.detail}</li>
              ))}
            </ul>
          </div>
        )}
        {runs.data && runs.data.length > 1 && (
          <details>
            <summary className="min-h-6 cursor-pointer text-sm font-semibold">Earlier syncs</summary>
            <ul className="mt-2 grid gap-1 text-sm">
              {runs.data.slice(1).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  {formatDateTime(r.started_at)} <RunStatus run={r} /> {r.status === 'ok' ? `${r.changes.length} changes` : r.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

function RunStatus({ run }: { run: SyncRun }) {
  if (run.status === 'ok') return <Badge variant="success">Synced</Badge>
  if (run.status === 'failed') return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="warning">Running</Badge>
}

const TABS = [
  { key: 'products', label: 'Products (VBN)' },
  { key: 'features', label: 'Features' },
  { key: 'packaging', label: 'Packaging' },
  { key: 'companies', label: 'Companies' },
] as const
type TabKey = (typeof TABS)[number]['key']

function CodesBrowser() {
  const { roles } = useAuth()
  const staff = hasAnyRole(roles, ['admin', 'consolidator', 'finance'])
  const q = useFloricode()
  const companies = useFloricodeCompanies(staff)
  const [tab, setTab] = React.useState<TabKey>('products')
  const [search, setSearch] = React.useState('')
  const term = search.trim().toLowerCase()
  const match = (...vals: (string | number | null | undefined)[]) => !term || vals.some((v) => String(v ?? '').toLowerCase().includes(term))
  const tabs = TABS.filter((t) => t.key !== 'companies' || staff)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Codes</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <div role="tablist" aria-label="Floricode lists" className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`fc-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls="fc-panel"
              onClick={() => setTab(t.key)}
              className={cn('min-h-10 rounded-md border px-3 text-sm font-semibold', tab === t.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid gap-1.5 sm:max-w-md">
          <Label htmlFor="fc-search">Search codes and names</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="fc-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
        <div id="fc-panel" role="tabpanel" aria-labelledby={`fc-tab-${tab}`} className="rounded-lg border">
          {q.isLoading && <Spinner />}
          {q.error && <Alert variant="destructive" title="Couldn't load the codes" role="alert">{(q.error as Error).message}</Alert>}
          {q.data && tab === 'products' && (
            <Table>
              <caption className="sr-only">Floricode products</caption>
              <THead>
                <TR>
                  <TH>VBN code</TH>
                  <TH>Name</TH>
                  <TH>Latin name</TH>
                  <TH>Group</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.products
                  .filter((p) => match(p.code, p.name, p.latin_name, p.product_group))
                  .map((p) => (
                    <TR key={p.code}>
                      <TD className="font-mono font-semibold">{p.code}</TD>
                      <TD>{p.name}</TD>
                      <TD>{p.latin_name}</TD>
                      <TD>{p.product_group}</TD>
                      <TD>
                        <CodeStatusBadge status={p.status} replacedBy={p.replaced_by} />
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
          {q.data && tab === 'features' && (
            <Table>
              <caption className="sr-only">Floricode features</caption>
              <THead>
                <TR>
                  <TH>Feature</TH>
                  <TH>Value code</TH>
                  <TH>Value</TH>
                  <TH>Used for</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.featureValues
                  .map((v) => ({ v, t: q.data.featureTypes.find((t) => t.code === v.feature_type) }))
                  .filter(({ v, t }) => match(v.feature_type, v.code, v.name, t?.name))
                  .map(({ v, t }) => (
                    <TR key={`${v.feature_type}-${v.code}`}>
                      <TD>
                        <span className="font-mono font-semibold">{v.feature_type}</span> {t?.name}
                      </TD>
                      <TD className="font-mono">{v.code}</TD>
                      <TD>{v.name}</TD>
                      <TD>{t?.product_field ? FIELD_LABEL[t.product_field] : '—'}</TD>
                      <TD>
                        <CodeStatusBadge status={v.status} />
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
          {q.data && tab === 'packaging' && (
            <Table>
              <caption className="sr-only">Floricode packaging</caption>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>L × W × H (cm)</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.packaging
                  .filter((p) => match(p.code, p.name))
                  .map((p) => (
                    <TR key={p.code}>
                      <TD className="font-mono font-semibold">{p.code}</TD>
                      <TD>{p.name}</TD>
                      <TD>{p.length_cm != null ? `${Number(p.length_cm)} × ${Number(p.width_cm)} × ${Number(p.height_cm)}` : '—'}</TD>
                      <TD>
                        <CodeStatusBadge status={p.status} />
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
          {tab === 'companies' && companies.data && (
            <Table>
              <caption className="sr-only">Floricode companies</caption>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>GLN</TH>
                  <TH>Country</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {companies.data
                  .filter((c) => match(c.code, c.name, c.gln, c.country))
                  .map((c) => (
                    <TR key={c.code}>
                      <TD className="font-mono font-semibold">{c.code}</TD>
                      <TD>{c.name}</TD>
                      <TD className="font-mono">{c.gln}</TD>
                      <TD>{c.country}</TD>
                      <TD className="capitalize">{c.kind}</TD>
                      <TD>
                        <CodeStatusBadge status={c.status} />
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
          {q.data && q.data.products.length === 0 && <p className="p-4 text-muted-foreground">No codes yet. An Admin can sync Floricode above.</p>}
        </div>
      </CardContent>
    </Card>
  )
}

const FIELD_LABEL = { stem_length_cm: 'Stem length', head_size_cm: 'Head size', maturity: 'Maturity', grade: 'Grade' } as const
