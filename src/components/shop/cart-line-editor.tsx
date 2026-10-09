import { Trash2 } from 'lucide-react'
import type { Bunching, CartLine, CatalogItem } from '~/lib/ordering/api'
import { Button } from '~/components/ui/button'
import { Input, Label } from '~/components/ui/input'
import { money } from './money'

/** One line of a cart or standing order: stems, how it's bunched, sleeves, bunch labels and a note. */
export function CartLineEditor({
  line,
  item,
  onChange,
  onRemove,
}: {
  line: CartLine
  item: CatalogItem | undefined
  onChange: (patch: Partial<CartLine>) => void
  onRemove: () => void
}) {
  const p = `line-${line.product_id}`
  const name = item ? `${item.variety} ${item.stem_length_cm} cm` : 'Product'
  const options: { id: Bunching; label: string }[] = [
    { id: 'standard', label: item ? `Standard: ${item.stems_per_bunch} stems per bunch` : 'Standard bunching' },
    { id: 'custom', label: 'My own bunching' },
    { id: 'consolflora', label: 'ConsolFlora decides bunching, sleeves and labels' },
  ]
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 font-bold">
        {name}
        {item && <span className="font-normal text-muted-foreground"> · {item.colour ?? item.flower_type} · {item.grade}</span>}
      </legend>
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor={`${p}-stems`}>Stems</Label>
          <Input id={`${p}-stems`} inputMode="numeric" value={line.stems || ''} onChange={(e) => onChange({ stems: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
        </div>
        <p className="text-sm text-muted-foreground">
          {item ? (
            <>
              {money(item.price_per_stem, item.currency, 3)} per stem · about <strong>{money(item.price_per_stem * line.stems, item.currency)}</strong>
            </>
          ) : (
            'No longer in the catalog. Remove it or ask ConsolFlora.'
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden="true" /> Remove<span className="sr-only"> {name}</span>
        </Button>
      </div>
      <div className="grid gap-1" role="radiogroup" aria-label={`Bunching for ${name}`}>
        {options.map((o) => (
          <label key={o.id} className="flex min-h-10 cursor-pointer items-center gap-2">
            <input type="radio" name={`${p}-bunching`} className="size-5 accent-accent" checked={line.bunching === o.id} onChange={() => onChange({ bunching: o.id })} />
            {o.label}
          </label>
        ))}
      </div>
      {line.bunching === 'custom' && (
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor={`${p}-spb`}>Stems per bunch</Label>
            <Input id={`${p}-spb`} inputMode="numeric" value={line.stems_per_bunch ?? ''} onChange={(e) => onChange({ stems_per_bunch: Number(e.target.value.replace(/\D/g, '')) || null })} />
          </div>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="size-6 shrink-0 accent-accent" checked={!!line.sleeves} onChange={(e) => onChange({ sleeves: e.target.checked })} /> Sleeves
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="size-6 shrink-0 accent-accent" checked={!!line.bunch_labels} onChange={(e) => onChange({ bunch_labels: e.target.checked })} /> Bunch labels
          </label>
        </div>
      )}
      <div className="grid gap-1">
        <Label htmlFor={`${p}-notes`}>Notes for this line (optional)</Label>
        <Input id={`${p}-notes`} value={line.notes} placeholder="e.g. Bunching by 3, mixed colours" onChange={(e) => onChange({ notes: e.target.value })} />
      </div>
    </fieldset>
  )
}
