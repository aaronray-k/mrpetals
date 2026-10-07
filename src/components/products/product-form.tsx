import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import {
  REVIEW_LABELS,
  resolveProductReview,
  saveProduct,
  useFloricode,
  type FeatureType,
  type FeatureValue,
  type ProductReview,
  type ProductRow,
} from '~/lib/floricode/api'
import { CodeStatusBadge } from '~/components/floricode/code-status'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { useToast } from '~/components/ui/toaster'

/** Order of the feature pick-lists: the ones that fill product fields first. */
const FIELD_ORDER = ['stem_length_cm', 'grade', 'head_size_cm', 'maturity'] as const
const REQUIRED = new Set(['stem_length_cm', 'grade'])

/** For products made before Floricode (e.g. imported): the feature values matching what the product already says. */
function guessFeatures(p: ProductRow, types: FeatureType[], values: FeatureValue[]) {
  const out: Record<string, string> = {}
  for (const t of types) {
    const vs = values.filter((v) => v.feature_type === t.code && v.status === 'active')
    const hit =
      t.product_field === 'stem_length_cm' ? vs.find((v) => Number(v.numeric_value) === p.stem_length_cm)
      : t.product_field === 'head_size_cm' ? vs.find((v) => p.head_size_cm != null && Number(v.numeric_value) === Number(p.head_size_cm))
      : t.product_field === 'grade' ? vs.find((v) => v.code === p.grade)
      : t.product_field === 'maturity' ? vs.find((v) => v.name === p.maturity)
      : undefined
    if (hit) out[t.code] = hit.code
  }
  return out
}

export function ProductForm({
  product,
  reviews,
  farms,
  onDone,
}: {
  product: ProductRow | null
  reviews: ProductReview[]
  farms: { id: string; farm_name: string }[]
  onDone: () => void
}) {
  const fc = useFloricode()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [code, setCode] = React.useState(product?.product_code ?? '')
  const [flower, setFlower] = React.useState(product?.flower_type ?? 'Rose')
  const [variety, setVariety] = React.useState(product?.variety ?? '')
  const [colour, setColour] = React.useState(product?.colour ?? '')
  const [vbn, setVbn] = React.useState(product?.vbn_code ?? '')
  const [vbnSearch, setVbnSearch] = React.useState('')
  const [features, setFeatures] = React.useState<Record<string, string> | null>(null)
  const [perBunch, setPerBunch] = React.useState(String(product?.stems_per_bunch ?? 20))
  const [farm, setFarm] = React.useState(product?.default_farm_id ?? '')
  const [active, setActive] = React.useState(product?.active ?? true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const data = fc.data
  // Start from the product's codes, or a best guess for products made before Floricode.
  React.useEffect(() => {
    if (!data || features) return
    const saved = product?.floricode_features ?? {}
    setFeatures(Object.keys(saved).length || !product ? { ...saved } : guessFeatures(product, data.featureTypes, data.featureValues))
  }, [data, features, product])

  if (fc.isLoading || !data || !features) return <Spinner />
  const noCodes = data.products.length === 0
  const selected = data.products.find((p) => p.code === vbn)
  const term = vbnSearch.trim().toLowerCase()
  const options = data.products
    .filter((p) => p.code === vbn || ((p.status === 'active') && (!term || `${p.code} ${p.name} ${p.latin_name ?? ''}`.toLowerCase().includes(term))))
    .slice(0, 60)
  const types = [...data.featureTypes]
    .filter((t) => t.status === 'active' || features[t.code])
    .sort((a, b) => {
      const ia = a.product_field ? FIELD_ORDER.indexOf(a.product_field) : 99
      const ib = b.product_field ? FIELD_ORDER.indexOf(b.product_field) : 99
      return ia - ib || a.code.localeCompare(b.code)
    })
  const flagged = (reason: ProductReview['reason']) => reviews.some((r) => r.reason === reason)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const missing = types.find((t) => t.product_field && REQUIRED.has(t.product_field) && !features![t.code])
    if (!noCodes && !vbn) return setError('Choose the VBN code.')
    if (missing) return setError(`Choose the ${missing.name.toLowerCase()}.`)
    setBusy(true)
    try {
      await saveProduct(product?.id ?? null, {
        product_code: code,
        flower_type: flower,
        variety,
        colour,
        vbn_code: vbn || null,
        stems_per_bunch: Number(perBunch),
        default_farm_id: farm || null,
        active,
        floricode_features: Object.fromEntries(Object.entries(features!).filter(([, v]) => v)),
      })
      toast({ kind: 'success', title: product ? 'Product saved' : 'Product added' })
      for (const k of ['products-floricode', 'product-reviews', 'order-reference-data', 'catalog']) void queryClient.invalidateQueries({ queryKey: [k] })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  async function markChecked(r: ProductReview) {
    try {
      await resolveProductReview(r.id)
      toast({ kind: 'success', title: 'Marked as checked' })
      void queryClient.invalidateQueries({ queryKey: ['product-reviews'] })
    } catch (err) {
      toast({ kind: 'error', title: 'Not changed', description: (err as Error).message })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{product ? `Edit ${product.product_code}` : 'Add a product'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} noValidate className="grid gap-4">
          {error && <Alert variant="destructive" title={error} role="alert" />}
          {reviews.length > 0 && (
            <Alert variant="warning" title="Needs review">
              <ul className="mt-1 grid gap-2">
                {reviews.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">{REVIEW_LABELS[r.reason]}</Badge>
                    <span>{r.detail}</span>
                    {r.reason === 'changed' && (
                      <Button size="sm" variant="outline" onClick={() => markChecked(r)}>
                        <Check aria-hidden="true" /> Mark as checked
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {noCodes && (
            <Alert title="No Floricode codes yet">
              An Admin can load them on the <Link to="/floricode" className="font-semibold underline">Floricode</Link> page. Until then the product is
              saved without codes.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pf-code" label="Product code" hint="ConsolFlora's own code, e.g. ROS-ER-70.">
              {(d) => <Input id="pf-code" value={code} onChange={(e) => setCode(e.target.value)} aria-describedby={d} autoComplete="off" />}
            </Field>
            <Field id="pf-flower" label="Flower">
              {(d) => <Input id="pf-flower" value={flower} onChange={(e) => setFlower(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="pf-variety" label="Variety">
              {(d) => <Input id="pf-variety" value={variety} onChange={(e) => setVariety(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="pf-colour" label="Colour (optional)">
              {(d) => <Input id="pf-colour" value={colour} onChange={(e) => setColour(e.target.value)} aria-describedby={d} />}
            </Field>
          </div>

          {!noCodes && (
            <fieldset className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-semibold">VBN code</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="pf-vbn-search" label="Find a code" hint="Type part of the name or the number.">
                  {(d) => <Input id="pf-vbn-search" type="search" value={vbnSearch} onChange={(e) => setVbnSearch(e.target.value)} aria-describedby={d} />}
                </Field>
                <Field id="pf-vbn" label="VBN code" error={flagged('blocked') || flagged('unknown_code') ? 'Choose an active code.' : undefined}>
                  {(d) => (
                    <Select id="pf-vbn" value={vbn} onChange={(e) => setVbn(e.target.value)} aria-describedby={d}>
                      <option value="">Choose…</option>
                      {options.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.code} · {p.name}
                          {p.status === 'blocked' ? ' (blocked)' : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              {selected && (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span>
                    {selected.latin_name ?? selected.name}
                    {selected.product_group ? ` · ${selected.product_group}` : ''}
                  </span>
                  <CodeStatusBadge status={selected.status} replacedBy={selected.replaced_by} />
                </p>
              )}
            </fieldset>
          )}

          {!noCodes && (
            <fieldset className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-semibold">Floricode features</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {types.map((t) => {
                  const values = data.featureValues.filter((v) => v.feature_type === t.code && (v.status === 'active' || v.code === features[t.code]))
                  const current = values.find((v) => v.code === features[t.code])
                  const required = t.product_field != null && REQUIRED.has(t.product_field)
                  return (
                    <Field
                      key={t.code}
                      id={`pf-f-${t.code}`}
                      label={`${t.name}${required ? '' : ' (optional)'}`}
                      hint={`Floricode ${t.code}`}
                      error={current?.status === 'blocked' ? 'Floricode blocked this value. Choose another.' : undefined}
                    >
                      {(d) => (
                        <Select
                          id={`pf-f-${t.code}`}
                          value={features[t.code] ?? ''}
                          onChange={(e) => setFeatures((f) => ({ ...f!, [t.code]: e.target.value }))}
                          aria-describedby={d}
                        >
                          <option value="">{required ? 'Choose…' : 'Not set'}</option>
                          {values.map((v) => (
                            <option key={v.code} value={v.code}>
                              {v.name}
                              {v.status === 'blocked' ? ' (blocked)' : ''}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  )
                })}
              </div>
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pf-bunch" label="Stems per bunch">
              {(d) => <Input id="pf-bunch" inputMode="numeric" value={perBunch} onChange={(e) => setPerBunch(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="pf-farm" label="Default farm (optional)">
              {(d) => (
                <Select id="pf-farm" value={farm} onChange={(e) => setFarm(e.target.value)} aria-describedby={d}>
                  <option value="">None</option>
                  {farms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.farm_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Switch checked={active} onCheckedChange={setActive} label="Product is active" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save product'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
