import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react'
import { createInvoice, useInvoiceFormData, useOdooSettings } from '~/lib/odoo/api'
import { suggestedDueDate } from '~/lib/odoo/terms'
import { cn } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/invoices/new')({
  head: () => ({ meta: [{ title: 'New invoice · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/invoices')}>
      <NewInvoicePage />
    </RequireRole>
  ),
})

type Line = { key: number; name: string; quantity: string; price: string }

function NewInvoicePage() {
  const form = useInvoiceFormData()
  const settings = useOdooSettings()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const nextKey = React.useRef(1)
  const [buyerId, setBuyerId] = React.useState('')
  const [kind, setKind] = React.useState<'invoice' | 'credit_note'>('invoice')
  const [currency, setCurrency] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [mawb, setMawb] = React.useState('')
  const [proforma, setProforma] = React.useState('')
  const [flight, setFlight] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [lines, setLines] = React.useState<Line[]>([{ key: 0, name: '', quantity: '1', price: '' }])
  const [errors, setErrors] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const label = settings.data?.line_label ?? 'Cut Flowers'

  const buyer = form.data?.buyers.find((b) => b.id === buyerId)
  const parsed = lines.map((l) => ({ name: l.name.trim() || label, quantity: Number(l.quantity), price_unit: Number(l.price) }))
  const total = Math.round(parsed.reduce((s, l) => s + (Number.isFinite(l.quantity * l.price_unit) ? l.quantity * l.price_unit : 0), 0) * 100) / 100

  function chooseBuyer(id: string) {
    setBuyerId(id)
    const b = form.data?.buyers.find((x) => x.id === id)
    if (b) {
      setCurrency(b.currency)
      setDueDate(kind === 'invoice' ? suggestedDueDate(b.payment_terms) : '')
    }
  }
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs: string[] = []
    if (!buyer) errs.push('Choose the buyer.')
    if (!currency) errs.push('Choose the currency.')
    if (!reference.trim()) errs.push('Give the invoice a reference, e.g. what it is for.')
    parsed.forEach((l, i) => {
      if (!(l.quantity > 0)) errs.push(`Line ${i + 1}: the quantity must be more than 0.`)
      if (!(l.price_unit >= 0) || lines[i]!.price.trim() === '') errs.push(`Line ${i + 1}: give a price (0 or more).`)
    })
    if (!errs.length && total <= 0) errs.push('The total must be more than 0.')
    setErrors(errs)
    if (errs.length) return
    setSaving(true)
    try {
      const r = await createInvoice({
        customerId: buyerId,
        kind,
        currency,
        reference: reference.trim(),
        lines: parsed,
        mawb: mawb.trim() || null,
        proforma: proforma.trim() || null,
        flight: flight.trim() || null,
        dueDate: dueDate || null,
      })
      toast({
        kind: r.pushed ? 'success' : 'error',
        title: r.pushed ? `${kind === 'invoice' ? 'Invoice' : 'Credit note'} is in Odoo as a draft` : 'Saved in ConsolFlora',
        description: r.pushed ? 'Check it against the preview, then confirm it.' : (r.message ?? undefined),
      })
      for (const k of ['invoices', 'odoo-moves']) void queryClient.invalidateQueries({ queryKey: [k] })
      void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: r.invoiceId } })
    } catch (err) {
      setErrors([(err as Error).message])
    } finally {
      setSaving(false)
    }
  }

  if (form.isLoading) return <Spinner />
  if (form.error) return <Alert variant="destructive" title="Couldn't load buyers" role="alert">{(form.error as Error).message}</Alert>

  return (
    <>
      <PageHeader
        title="New invoice"
        description="Write an invoice or credit note by hand. It goes to Odoo as a draft, with the MAWB, proforma number and flight in Odoo's fields, to check and confirm like the others."
        actions={
          <Link to="/odoo-invoices" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" /> All invoices in Odoo
          </Link>
        }
      />
      <form noValidate onSubmit={submit} className="grid grid-cols-1 gap-4">
        {errors.length > 0 && (
          <Alert variant="destructive" title="Check these first" role="alert">
            <ul className="list-disc pl-5">
              {errors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Buyer and details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <fieldset className="flex w-fit flex-wrap gap-1 rounded-md border border-input bg-card p-1">
              <legend className="sr-only">Type</legend>
              {(['invoice', 'credit_note'] as const).map((k) => (
                <label key={k} className={cn('inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', kind === k && 'bg-accent/20')}>
                  <input
                    type="radio"
                    name="invoice-kind"
                    className="sr-only"
                    checked={kind === k}
                    onChange={() => {
                      setKind(k)
                      if (k === 'credit_note') setDueDate('')
                      else if (buyer) setDueDate(suggestedDueDate(buyer.payment_terms))
                    }}
                  />
                  {k === 'invoice' ? 'Invoice' : 'Credit note'}
                </label>
              ))}
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field id="ni-buyer" label="Buyer" hint={buyer ? `Terms: ${buyer.payment_terms}` : undefined}>
                {(d) => (
                  <Select id="ni-buyer" value={buyerId} onChange={(e) => chooseBuyer(e.target.value)} aria-describedby={d} aria-invalid={errors.includes('Choose the buyer.')}>
                    <option value="">Choose…</option>
                    {form.data!.buyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.company_name} ({b.customer_code})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="ni-currency" label="Currency">
                {(d) => (
                  <Select id="ni-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-describedby={d}>
                    <option value="">Choose…</option>
                    {form.data!.currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="ni-ref" label="Reference" hint="What it is for; Odoo shows it as the invoice reference.">
                {(d) => <Input id="ni-ref" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} aria-describedby={d} />}
              </Field>
              <Field id="ni-mawb" label="MAWB / AWB">
                {(d) => <Input id="ni-mawb" value={mawb} maxLength={40} onChange={(e) => setMawb(e.target.value)} aria-describedby={d} />}
              </Field>
              <Field id="ni-proforma" label="Proforma invoice no." hint="e.g. CFLPFJ0001">
                {(d) => <Input id="ni-proforma" value={proforma} maxLength={500} onChange={(e) => setProforma(e.target.value)} aria-describedby={d} />}
              </Field>
              <Field id="ni-flight" label="Flight number">
                {(d) => <Input id="ni-flight" value={flight} maxLength={40} onChange={(e) => setFlight(e.target.value)} aria-describedby={d} />}
              </Field>
              <Field id="ni-due" label="Due date" hint={kind === 'invoice' ? "From the buyer's terms; change it if needed. Empty: Odoo's payment term decides." : 'Credit notes have no due date.'}>
                {(d) => <Input id="ni-due" type="date" value={dueDate} disabled={kind === 'credit_note'} onChange={(e) => setDueDate(e.target.value)} aria-describedby={d} />}
              </Field>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lines</CardTitle>
            <CardDescription>Description, quantity and unit price. An empty description becomes "{label}". No tax is added here; Odoo's setup applies.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {lines.map((l, i) => (
              <fieldset key={l.key} className="grid grid-cols-1 items-end gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <legend className="px-1 text-sm font-semibold">Line {i + 1}</legend>
                <Field id={`ni-l${l.key}-name`} label="Description">
                  {(d) => <Input id={`ni-l${l.key}-name`} value={l.name} placeholder={label} maxLength={500} onChange={(e) => setLine(l.key, { name: e.target.value })} aria-describedby={d} />}
                </Field>
                <Field id={`ni-l${l.key}-qty`} label="Quantity">
                  {(d) => <Input id={`ni-l${l.key}-qty`} type="number" inputMode="decimal" min="0" step="any" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} aria-describedby={d} />}
                </Field>
                <Field id={`ni-l${l.key}-price`} label={`Unit price${currency ? ` (${currency})` : ''}`}>
                  {(d) => <Input id={`ni-l${l.key}-price`} type="number" inputMode="decimal" min="0" step="any" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} aria-describedby={d} />}
                </Field>
                <Button variant="outline" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </fieldset>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline" disabled={lines.length >= 50} onClick={() => setLines((ls) => [...ls, { key: nextKey.current++, name: '', quantity: '1', price: '' }])}>
                <Plus aria-hidden="true" /> Add a line
              </Button>
              <p className="text-lg font-semibold tabular-nums" aria-live="polite">
                Total: {currency ? money(kind === 'credit_note' ? -total : total, currency) : total.toFixed(2)}
              </p>
            </div>
          </CardContent>
        </Card>
        <div>
          <Button type="submit" disabled={saving}>
            <Send aria-hidden="true" /> {saving ? 'Sending…' : 'Create and send to Odoo as a draft'}
          </Button>
        </div>
      </form>
    </>
  )
}
