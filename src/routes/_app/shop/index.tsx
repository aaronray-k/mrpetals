import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus, Search, ShoppingCart } from 'lucide-react'
import { useCart, useCatalog, type CatalogItem } from '~/lib/ordering/api'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button, buttonVariants } from '~/components/ui/button'
import { Input, Label, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'
import { money } from '~/components/shop/money'

export const Route = createFileRoute('/_app/shop/')({
  head: () => ({ meta: [{ title: 'Catalog · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/shop')}>
      <CatalogPage />
    </RequireRole>
  ),
})

function CatalogPage() {
  const catalog = useCatalog()
  const cart = useCart()
  const [search, setSearch] = React.useState('')
  const [type, setType] = React.useState('')
  const [length, setLength] = React.useState('')
  const items = catalog.data ?? []
  const types = [...new Set(items.map((i) => i.flower_type))].sort()
  const lengths = [...new Set(items.map((i) => i.stem_length_cm))].sort((a, b) => a - b)
  const term = search.trim().toLowerCase()
  const shown = items.filter(
    (i) =>
      (!term || `${i.variety} ${i.colour ?? ''} ${i.product_code}`.toLowerCase().includes(term)) &&
      (!type || i.flower_type === type) &&
      (!length || String(i.stem_length_cm) === length),
  )
  const cartStems = cart.lines.reduce((s, l) => s + l.stems, 0)

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Prices are per stem, for your incoterm. Every order is confirmed with the farms before it ships."
        actions={
          <Link to="/shop/checkout" className={buttonVariants()}>
            <ShoppingCart aria-hidden="true" /> Cart ({cart.lines.length} {cart.lines.length === 1 ? 'line' : 'lines'}, {cartStems.toLocaleString('en-GB')} stems)
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="shop.catalog" title="How ordering works">
          Add stems of each variety and length to your cart, then choose your flight at checkout. Orders need at least 72 hours before the
          flight. ConsolFlora approves the order and confirms it with the farms; you can follow each step under <strong>My orders</strong>.
        </Tip>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cat-search">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" />
              <Input id="cat-search" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Variety or colour" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cat-type">Flower</Label>
            <Select id="cat-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All flowers</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cat-length">Stem length</Label>
            <Select id="cat-length" value={length} onChange={(e) => setLength(e.target.value)}>
              <option value="">All lengths</option>
              {lengths.map((l) => (
                <option key={l} value={l}>
                  {l} cm
                </option>
              ))}
            </Select>
          </div>
        </div>
        {catalog.isLoading && <Spinner />}
        {catalog.error && (
          <Alert variant="destructive" title="Couldn't load the catalog" role="alert">
            {(catalog.error as Error).message}
          </Alert>
        )}
        {catalog.data && (
          <div className="rounded-lg border bg-card">
            <Table>
              <caption className="sr-only">Catalog</caption>
              <THead>
                <TR>
                  <TH>Variety</TH>
                  <TH>Length</TH>
                  <TH>Head</TH>
                  <TH>Grade</TH>
                  <TH>Bunch</TH>
                  <TH className="text-right">Price per stem</TH>
                  <TH>Add to cart</TH>
                </TR>
              </THead>
              <TBody>
                {shown.map((i) => (
                  <CatalogRow key={i.product_id} item={i} inCart={cart.lines.find((l) => l.product_id === i.product_id)?.stems ?? 0} onAdd={(stems) => cart.add({ product_id: i.product_id, stems, bunching: 'standard', stems_per_bunch: null, sleeves: null, bunch_labels: null, notes: '' })} />
                ))}
                {shown.length === 0 && (
                  <TR>
                    <TD colSpan={7} className="text-muted-foreground">
                      Nothing matches. Clear the filters, or ask ConsolFlora for what you need.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </>
  )
}

function CatalogRow({ item, inCart, onAdd }: { item: CatalogItem; inCart: number; onAdd: (stems: number) => void }) {
  const toast = useToast()
  const [stems, setStems] = React.useState(String(item.stems_per_bunch * 10))
  const id = `add-${item.product_id}`
  return (
    <TR>
      <TD>
        <span className="font-semibold">{item.variety}</span>
        <span className="block text-sm text-muted-foreground">
          {item.flower_type}
          {item.colour ? ` · ${item.colour}` : ''} · {item.product_code}
        </span>
      </TD>
      <TD className="whitespace-nowrap">{item.stem_length_cm} cm</TD>
      <TD className="whitespace-nowrap">{item.head_size_cm ? `${item.head_size_cm} cm` : '—'}</TD>
      <TD>{item.grade}</TD>
      <TD className="whitespace-nowrap">{item.stems_per_bunch} stems</TD>
      <TD className="text-right font-semibold tabular-nums">{money(item.price_per_stem, item.currency, 3)}</TD>
      <TD>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(stems)
            if (!Number.isInteger(n) || n <= 0) return toast({ kind: 'error', title: 'Enter a whole number of stems' })
            onAdd(n)
            toast({ kind: 'success', title: `${n.toLocaleString('en-GB')} stems of ${item.variety} ${item.stem_length_cm} cm added` })
          }}
        >
          <label htmlFor={id} className="sr-only">
            Stems of {item.variety} {item.stem_length_cm} cm
          </label>
          <Input id={id} inputMode="numeric" className="w-24" value={stems} onChange={(e) => setStems(e.target.value)} />
          <Button type="submit" size="sm" variant="outline">
            <Plus aria-hidden="true" /> Add<span className="sr-only"> {item.variety} {item.stem_length_cm} cm</span>
          </Button>
          {inCart > 0 && <span className="text-sm whitespace-nowrap text-muted-foreground">{inCart.toLocaleString('en-GB')} in cart</span>}
        </form>
      </TD>
    </TR>
  )
}
