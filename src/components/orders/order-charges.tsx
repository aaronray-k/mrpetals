import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { addCharge, removeCharge, type OrderCharge } from '~/lib/orders/api'
import { Button } from '~/components/ui/button'
import { Input, Label } from '~/components/ui/input'
import { useToast } from '~/components/ui/toaster'

const COMMON = ['Consolidation fee', 'Data logger', 'Labelling', 'UCR', 'Phytosanitary certificate']

const money = (n: number, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n)

/** "Other costs" on the proforma: consolidation fee, data logger and so on. */
export function OrderCharges({
  orderId,
  currency,
  charges,
  canEdit,
  onChanged,
}: {
  orderId: string
  currency: string
  charges: OrderCharge[]
  canEdit: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [description, setDescription] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const total = charges.reduce((s, c) => s + c.amount, 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(amount.trim())
    if (!description.trim()) return setError('Describe the cost.')
    if (!amount.trim() || !Number.isFinite(n)) return setError('Enter the amount as a number, like 80 or 26.50.')
    setBusy(true)
    setError(null)
    try {
      await addCharge(orderId, description.trim(), Math.round(n * 100) / 100, Math.max(0, ...charges.map((c) => c.sort_order)) + 1)
      toast({ kind: 'success', title: `${description.trim()} added` })
      setDescription('')
      setAmount('')
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      {charges.length === 0 ? (
        <p className="text-muted-foreground">No other costs on this order.</p>
      ) : (
        <ul className="grid divide-y rounded-md border">
          {charges.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">{c.description}</span>
              <span className="tabular-nums">{money(c.amount, currency)}</span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await removeCharge(c.id)
                      toast({ kind: 'success', title: `${c.description} removed` })
                      onChanged()
                    } catch (err) {
                      toast({ kind: 'error', title: 'Not removed', description: (err as Error).message })
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  <span className="sr-only">Remove {c.description}</span>
                </Button>
              )}
            </li>
          ))}
          <li className="flex items-center gap-3 px-3 py-2 font-bold">
            <span className="flex-1">Other costs total</span>
            <span className="tabular-nums">{money(total, currency)}</span>
            {canEdit && <span className="w-9" aria-hidden="true" />}
          </li>
        </ul>
      )}

      {canEdit && (
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end" aria-label="Add a cost">
          <div className="grid gap-1">
            <Label htmlFor="charge-description">Cost</Label>
            <Input id="charge-description" list="charge-suggestions" value={description} maxLength={80} onChange={(e) => setDescription(e.target.value)} />
            <datalist id="charge-suggestions">
              {COMMON.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="charge-amount">Amount ({currency})</Label>
            <Input id="charge-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            <Plus aria-hidden="true" /> Add cost
          </Button>
          {error && (
            <p className="text-sm font-semibold text-destructive sm:col-span-3" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
