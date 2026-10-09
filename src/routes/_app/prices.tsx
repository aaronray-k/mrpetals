import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { productLabel, useReferenceData } from '~/lib/orders/api'
import { savePriceOverride, useCatalog, usePriceOverrides } from '~/lib/ordering/api'
import { useIncoterms } from '~/lib/orders/api'
import { useAuth } from '~/lib/auth'
import { hasAnyRole } from '~/lib/roles'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input, Label, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/prices')({
  head: () => ({ meta: [{ title: 'Selling prices · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/prices')}>
      <PricesPage />
    </RequireRole>
  ),
})

function PricesPage() {
  const { roles } = useAuth()
  const ref = useReferenceData()
  const incoterms = useIncoterms()
  const overrides = usePriceOverrides()
  const [incoterm, setIncoterm] = React.useState('FOB')
  const [currency, setCurrency] = React.useState('USD')
  const [buyerId, setBuyerId] = React.useState('')
  const canEdit = hasAnyRole(roles, ['admin'])
  const currencies = [...new Set(['USD', 'EUR', ...(ref.data?.buyers ?? []).map((b) => b.currency)])].sort()
  const buyersForTerm = (ref.data?.buyers ?? []).filter((b) => b.incoterm === incoterm && b.currency === currency)
  const findOverride = (productId: string) => overrides.data?.find((o) => o.product_id === productId && o.incoterm === incoterm && o.currency === currency)
  const previewBuyer = buyerId || buyersForTerm[0]?.id || null
  const catalog = useCatalog(previewBuyer, previewBuyer != null)

  if (ref.isLoading || overrides.isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="Selling prices" description="What buyers pay per stem, per variety and length. By default: the cheapest farm's price plus the margin for the incoterm." />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="prices.how" title="Pinning a farm or fixing a price">
          Pin a farm to buy a product from that farm by default (the calculator recommends it, and the price follows that farm). Or fix the
          selling price per stem, in the buyer's currency: a fixed USD price applies to USD buyers only. A pinned farm applies to every currency unless pinned separately. Clear both to go back to cheapest
          farm plus margin.
        </Tip>
        {!canEdit && <Alert title="Only Admin users can change selling prices." />}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="p-currency">Buyer currency</Label>
            <Select id="p-currency" value={currency} onChange={(e) => { setCurrency(e.target.value); setBuyerId('') }}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-incoterm">Incoterm</Label>
            <Select id="p-incoterm" value={incoterm} onChange={(e) => { setIncoterm(e.target.value); setBuyerId('') }}>
              {(incoterms.data ?? ['FOB']).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-buyer">See prices as buyer</Label>
            <Select id="p-buyer" value={previewBuyer ?? ''} onChange={(e) => setBuyerId(e.target.value)}>
              {buyersForTerm.length === 0 && <option value="">No {incoterm} buyers in {currency}</option>}
              {buyersForTerm.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.company_name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="rounded-lg border bg-card">
          <Table>
            <caption className="sr-only">Selling prices for {incoterm} in {currency}</caption>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH className="text-right">Buyer price now</TH>
                <TH>Pinned farm</TH>
                <TH>Fixed price per stem ({currency})</TH>
                {canEdit && (
                  <TH>
                    <span className="sr-only">Save</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {(ref.data?.products ?? []).map((p) => (
                <PriceRow
                  key={`${p.id}-${incoterm}-${currency}-${JSON.stringify(findOverride(p.id) ?? null)}`}
                  productId={p.id}
                  label={`${productLabel(p)} (${p.product_code})`}
                  incoterm={incoterm}
                  currency={currency}
                  now={previewBuyer ? catalog.data?.find((c) => c.product_id === p.id) : undefined}
                  override={findOverride(p.id)}
                  farms={ref.data?.farms ?? []}
                  canEdit={canEdit}
                />
              ))}
            </TBody>
          </Table>
        </div>
      </div>
    </>
  )
}

function PriceRow({
  productId,
  label,
  incoterm,
  currency,
  now,
  override,
  farms,
  canEdit,
}: {
  productId: string
  label: string
  incoterm: string
  currency: string
  now: { price_per_stem: number; currency: string } | undefined
  override: { pinned_farm_id: string | null; sell_price_per_stem: number | null } | undefined
  farms: { id: string; farm_name: string }[]
  canEdit: boolean
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [farm, setFarm] = React.useState(override?.pinned_farm_id ?? '')
  const [price, setPrice] = React.useState(override?.sell_price_per_stem == null ? '' : String(override.sell_price_per_stem))
  const dirty = farm !== (override?.pinned_farm_id ?? '') || price !== (override?.sell_price_per_stem == null ? '' : String(override.sell_price_per_stem))
  return (
    <TR>
      <TD>{label}</TD>
      <TD className="text-right tabular-nums">{now ? `${now.price_per_stem.toFixed(3)} ${now.currency}` : 'No price'}</TD>
      <TD>
        <label className="sr-only" htmlFor={`pin-${productId}`}>
          Pinned farm for {label}
        </label>
        <Select id={`pin-${productId}`} value={farm} disabled={!canEdit} onChange={(e) => setFarm(e.target.value)}>
          <option value="">Cheapest farm</option>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.farm_name}
            </option>
          ))}
        </Select>
      </TD>
      <TD>
        <label className="sr-only" htmlFor={`fix-${productId}`}>
          Fixed price for {label}
        </label>
        <Input id={`fix-${productId}`} inputMode="decimal" value={price} disabled={!canEdit} placeholder="Not fixed" onChange={(e) => setPrice(e.target.value)} className="w-32" />
      </TD>
      {canEdit && (
        <TD>
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty}
            onClick={async () => {
              const n = price.trim() === '' ? null : Number(price)
              if (n != null && (!Number.isFinite(n) || n < 0)) return toast({ kind: 'error', title: 'Enter a price of 0 or more' })
              try {
                await savePriceOverride({ product_id: productId, incoterm, currency, pinned_farm_id: farm || null, sell_price_per_stem: n })
                toast({ kind: 'success', title: 'Price saved' })
                void queryClient.invalidateQueries({ queryKey: ['price-overrides'] })
                void queryClient.invalidateQueries({ queryKey: ['catalog'] })
              } catch (e) {
                toast({ kind: 'error', title: 'Not saved', description: (e as Error).message })
              }
            }}
          >
            Save<span className="sr-only"> {label}</span>
          </Button>
        </TD>
      )}
    </TR>
  )
}
