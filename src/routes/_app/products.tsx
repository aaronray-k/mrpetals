import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { FileSpreadsheet, Pencil, Plus, Search } from 'lucide-react'
import { useAuth } from '~/lib/auth'
import { STAFF_ROLES, hasAnyRole } from '~/lib/roles'
import { REVIEW_LABELS, useFloricode, useProductReviews, useProducts, type ProductRow } from '~/lib/floricode/api'
import { useReferenceData } from '~/lib/orders/api'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { ProductForm } from '~/components/products/product-form'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input, Label } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/_app/products')({
  head: () => ({ meta: [{ title: 'Products · ConsolFlora' }] }),
  validateSearch: (s: Record<string, unknown>): { review?: boolean } => (s.review === true || s.review === 'true' ? { review: true } : {}),
  component: () => (
    <RequireRole roles={rolesFor('/products')}>
      <ProductsPage />
    </RequireRole>
  ),
})

function ProductsPage() {
  const { roles } = useAuth()
  const staff = hasAnyRole(roles, STAFF_ROLES)
  const products = useProducts()
  const reviews = useProductReviews(staff)
  const fc = useFloricode()
  const ref = useReferenceData()
  const { review } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [search, setSearch] = React.useState('')
  const [showInactive, setShowInactive] = React.useState(false)
  const [editing, setEditing] = React.useState<ProductRow | 'new' | null>(null)
  const formRef = React.useRef<HTMLDivElement>(null)

  const byProduct = new Map<string, NonNullable<typeof reviews.data>>()
  for (const r of reviews.data ?? []) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r])
  const fcName = (code: string | null) => fc.data?.products.find((p) => p.code === code)?.name
  const term = search.trim().toLowerCase()
  const rows = (products.data ?? []).filter(
    (p) =>
      (showInactive || p.active) &&
      (!review || byProduct.has(p.id)) &&
      (!term || [p.product_code, p.flower_type, p.variety, p.colour, p.vbn_code, fcName(p.vbn_code)].some((v) => String(v ?? '').toLowerCase().includes(term))),
  )
  const toReview = (products.data ?? []).filter((p) => byProduct.has(p.id)).length

  function edit(p: ProductRow | 'new') {
    setEditing(p)
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start' }))
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Each code is one flower, variety, grade and stem length, with its Floricode codes."
        actions={
          staff && (
            <>
              <Link to="/import" className={buttonVariants({ variant: 'outline' })}>
                <FileSpreadsheet aria-hidden="true" /> Import
              </Link>
              {!editing && (
                <Button onClick={() => edit('new')}>
                  <Plus aria-hidden="true" /> Add product
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4">
        {staff && (
          <Tip id="products.floricode" title="Floricode codes">
            The VBN code, stem length, head size, ripeness and quality group come from the{' '}
            <Link to="/floricode" className="font-semibold underline">Floricode</Link> lists. Products are flagged for review when they have no
            code or when Floricode blocks or changes theirs.
          </Tip>
        )}
        <div ref={formRef} className="scroll-mt-4">
          {editing && (
            <ProductForm
              key={editing === 'new' ? 'new' : editing.id}
              product={editing === 'new' ? null : editing}
              reviews={editing === 'new' ? [] : (byProduct.get(editing.id) ?? [])}
              farms={ref.data?.farms ?? []}
              onDone={() => setEditing(null)}
            />
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="products-search">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="products-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
          {staff && (
            <fieldset className="flex gap-1 rounded-md border border-input bg-card p-1">
              <legend className="sr-only">Show</legend>
              {[
                { on: false, label: 'All products' },
                { on: true, label: `Needs review (${toReview})` },
              ].map((o) => (
                <label
                  key={o.label}
                  className={cn(
                    'inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                    !!review === o.on && 'bg-accent/20',
                  )}
                >
                  <input
                    type="radio"
                    name="products-filter"
                    className="sr-only"
                    checked={!!review === o.on}
                    onChange={() => void navigate({ search: o.on ? { review: true } : {}, replace: true })}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          )}
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-6 shrink-0 accent-accent" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>

        {products.isLoading && <Spinner />}
        {products.error && (
          <Alert variant="destructive" title="Couldn't load products" role="alert">
            {(products.error as Error).message}
          </Alert>
        )}
        {products.data && (
          <Card>
            <p className="sr-only" role="status">
              {rows.length} {rows.length === 1 ? 'product' : 'products'} shown
            </p>
            <Table>
              <caption className="sr-only">Products</caption>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Product</TH>
                  <TH>VBN</TH>
                  <TH>Length</TH>
                  <TH>Grade</TH>
                  <TH>Stems / bunch</TH>
                  {staff && <TH>Review</TH>}
                  {staff && (
                    <TH>
                      <span className="sr-only">Edit</span>
                    </TH>
                  )}
                </TR>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-semibold">
                      {p.product_code}
                      {!p.active && <Badge className="ml-2">Inactive</Badge>}
                    </TD>
                    <TD>
                      {p.variety}
                      <span className="block text-sm text-muted-foreground">{[p.flower_type, p.colour].filter(Boolean).join(' · ')}</span>
                    </TD>
                    <TD>
                      {p.vbn_code ? (
                        <>
                          <span className="font-mono">{p.vbn_code}</span>
                          {fcName(p.vbn_code) && <span className="block text-sm text-muted-foreground">{fcName(p.vbn_code)}</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>{p.stem_length_cm} cm</TD>
                    <TD>{p.grade}</TD>
                    <TD>{p.stems_per_bunch}</TD>
                    {staff && (
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {(byProduct.get(p.id) ?? []).map((r) => (
                            <Badge key={r.id} variant="warning" title={r.detail}>
                              {REVIEW_LABELS[r.reason]}
                            </Badge>
                          ))}
                        </div>
                      </TD>
                    )}
                    {staff && (
                      <TD>
                        <Button size="sm" variant="outline" onClick={() => edit(p)}>
                          <Pencil aria-hidden="true" /> Edit<span className="sr-only"> {p.product_code}</span>
                        </Button>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
            {rows.length === 0 && <p className="p-4 text-muted-foreground">{review ? 'No products need review.' : 'No products match.'}</p>}
          </Card>
        )}
      </div>
    </>
  )
}
