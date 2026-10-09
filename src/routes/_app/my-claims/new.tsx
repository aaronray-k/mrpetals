import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, ScanLine, Trash2 } from 'lucide-react'
import { submitClaim, useClaimableBoxes, type ClaimLineInput, type ClaimableBox } from '~/lib/claims/api'
import { useQcReasons } from '~/lib/qc/api'
import { parseScan } from '~/lib/qc/parse'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/my-claims/new')({
  head: () => ({ meta: [{ title: 'Report a problem · ConsolFlora' }] }),
  validateSearch: (s: Record<string, unknown>): { shipment?: string } => (typeof s.shipment === 'string' ? { shipment: s.shipment } : {}),
  component: () => (
    <RequireRole roles={rolesFor('/my-claims')}>
      <NewClaim />
    </RequireRole>
  ),
})

type Line = ClaimLineInput & { box: ClaimableBox }

function NewClaim() {
  const boxes = useClaimableBoxes()
  const reasons = useQcReasons()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { shipment: wanted } = Route.useSearch()
  const shipments = [...new Map((boxes.data ?? []).map((b) => [b.shipment_id, b])).values()]
  const [shipmentId, setShipmentId] = React.useState<string>('')
  const [lines, setLines] = React.useState<Line[]>([])
  const [costs, setCosts] = React.useState<{ description: string; amount: string }[]>([])
  const [note, setNote] = React.useState('')
  const [scan, setScan] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!shipmentId && shipments.length) setShipmentId(shipments.find((s) => s.shipment_id === wanted)?.shipment_id ?? shipments[0]!.shipment_id)
  }, [shipments, shipmentId, wanted])

  if (boxes.isLoading || reasons.isLoading) return <Spinner />
  const onShipment = (boxes.data ?? []).filter((b) => b.shipment_id === shipmentId)
  const current = shipments.find((s) => s.shipment_id === shipmentId)
  const toggle = (b: ClaimableBox, on: boolean) =>
    setLines((ls) => (on ? [...ls, { box_id: b.box_id, reason: '', stems: b.stems, note: '', photos: [], box: b }] : ls.filter((l) => l.box_id !== b.box_id)))
  const update = (id: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.box_id === id ? { ...l, ...p } : l)))
  const total = lines.reduce((s, l) => s + l.stems * l.box.price_per_stem, 0)
  const needsNote = (code: string) => reasons.data?.find((r) => r.code === code)?.needs_note

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!lines.length) return setError('Choose at least one box.')
    const bad = lines.find((l) => !l.reason || l.stems < 1 || l.stems > l.box.stems || (needsNote(l.reason) && l.note.trim().length < 3))
    if (bad) return setError(`Box ${bad.box_id}: choose a reason, between 1 and ${bad.box.stems} stems${needsNote(bad.reason) ? ', and describe the problem' : ''}.`)
    const parsedCosts = costs.filter((c) => c.description.trim() || c.amount.trim()).map((c) => ({ description: c.description.trim(), amount: Number(c.amount) }))
    if (parsedCosts.some((c) => c.description.length < 2 || !(c.amount > 0))) return setError('Each extra cost needs a description and an amount.')
    setBusy(true)
    try {
      const r = await submitClaim(shipmentId, lines, parsedCosts, note)
      toast({
        kind: r.failedPhotos.length ? 'error' : 'success',
        title: `Claim ${r.claim_number} sent`,
        description: r.failedPhotos.length ? `${r.failedPhotos.length} photos didn't upload. Add them on the claim page.` : 'ConsolFlora will review it and let you know.',
      })
      void queryClient.invalidateQueries({ queryKey: ['claims'] })
      void queryClient.invalidateQueries({ queryKey: ['claimable-boxes'] })
      void navigate({ to: '/my-claims/$claimId', params: { claimId: r.claim_id } })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Report a problem" description="Choose the boxes, say what's wrong and add photos. One claim per shipment." />
      {shipments.length === 0 ? (
        <Alert title="No boxes to claim on right now">
          You can report a problem with a shipment within the claim window after it lands. Shipments outside the window, or boxes already
          claimed, aren't listed. <Link to="/my-claims" className="font-semibold underline">Back to my claims</Link>
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4">
          {error && <Alert variant="destructive" title={error} role="alert" />}
          <Card>
            <CardHeader>
              <CardTitle>Shipment</CardTitle>
              {current && <CardDescription>Report by {formatDateTime(current.deadline)} (the claim window).</CardDescription>}
            </CardHeader>
            <CardContent>
              <Field id="claim-shipment" label="Which shipment">
                {(d) => (
                  <Select id="claim-shipment" value={shipmentId} onChange={(e) => { setShipmentId(e.target.value); setLines([]) }} aria-describedby={d}>
                    {shipments.map((s) => (
                      <option key={s.shipment_id} value={s.shipment_id}>
                        {s.shipment_ref} · flight {s.flight_date}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Boxes</CardTitle>
              <CardDescription>Tick the boxes with a problem, or scan the QR code on the box label.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field id="claim-scan" label="Scan or type a box ID" hint="8 digits, from the box label.">
                  {(d) => <Input id="claim-scan" value={scan} onChange={(e) => setScan(e.target.value)} aria-describedby={d} className="sm:w-64" />}
                </Field>
                <Button
                  variant="outline"
                  onClick={() => {
                    const r = parseScan(scan)
                    if ('error' in r) return setError(r.error)
                    const b = onShipment.find((x) => x.box_id === r.boxId)
                    if (!b) return setError(`Box ${r.boxId} isn't one of your boxes on this shipment, or was already claimed.`)
                    setError(null)
                    if (!lines.some((l) => l.box_id === b.box_id)) toggle(b, true)
                    setScan('')
                  }}
                >
                  <ScanLine aria-hidden="true" /> Add box
                </Button>
              </div>
              <ul className="grid gap-2">
                {onShipment.map((b) => {
                  const line = lines.find((l) => l.box_id === b.box_id)
                  return (
                    <li key={b.box_id} className="rounded-md border">
                      <label className="flex cursor-pointer items-center gap-3 p-3">
                        <input type="checkbox" className="size-6 shrink-0 accent-accent" checked={!!line} onChange={(e) => toggle(b, e.target.checked)} />
                        <span className="grid">
                          <span className="font-semibold">
                            Box {String(b.box_id).padStart(8, '0')} · {b.product}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Box {b.buyer_box_no} · {b.order_number} · {b.stems} stems · {money(b.price_per_stem, b.currency, 3)} per stem
                          </span>
                        </span>
                      </label>
                      {line && (
                        <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
                          <Field id={`r-${b.box_id}`} label="What's wrong">
                            {(d) => (
                              <Select id={`r-${b.box_id}`} value={line.reason} onChange={(e) => update(b.box_id, { reason: e.target.value })} aria-describedby={d}>
                                <option value="">Choose…</option>
                                {reasons.data?.map((r) => (
                                  <option key={r.code} value={r.code}>
                                    {r.label}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </Field>
                          <Field id={`s-${b.box_id}`} label="Stems affected" hint={`Up to ${b.stems}.`}>
                            {(d) => (
                              <Input id={`s-${b.box_id}`} inputMode="numeric" value={String(line.stems)} onChange={(e) => update(b.box_id, { stems: Number(e.target.value.replace(/\D/g, '')) || 0 })} aria-describedby={d} />
                            )}
                          </Field>
                          <Field id={`n-${b.box_id}`} label={needsNote(line.reason) ? 'Describe the problem' : 'Note (optional)'}>
                            {(d) => <Input id={`n-${b.box_id}`} value={line.note} onChange={(e) => update(b.box_id, { note: e.target.value })} aria-describedby={d} />}
                          </Field>
                          <Field id={`p-${b.box_id}`} label="Photos" hint={line.photos.length ? `${line.photos.length} chosen.` : 'Flowers and the box label. On a phone, this opens the camera.'}>
                            {(d) => (
                              <Input
                                id={`p-${b.box_id}`}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                multiple
                                onChange={(e) => update(b.box_id, { photos: [...line.photos, ...Array.from(e.target.files ?? [])] })}
                                aria-describedby={d}
                              />
                            )}
                          </Field>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Extra costs (optional)</CardTitle>
              <CardDescription>For example fumigation or disposal, in {current?.currency}.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {costs.map((c, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <Field id={`cd-${i}`} label="Cost">
                    {(d) => <Input id={`cd-${i}`} value={c.description} onChange={(e) => setCosts((cs) => cs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} aria-describedby={d} />}
                  </Field>
                  <Field id={`ca-${i}`} label="Amount">
                    {(d) => <Input id={`ca-${i}`} inputMode="decimal" value={c.amount} onChange={(e) => setCosts((cs) => cs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} aria-describedby={d} className="w-32" />}
                  </Field>
                  <Button variant="ghost" onClick={() => setCosts((cs) => cs.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" /> Remove<span className="sr-only"> cost {i + 1}</span>
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="justify-self-start" onClick={() => setCosts((cs) => [...cs, { description: '', amount: '' }])}>
                <Plus aria-hidden="true" /> Add a cost
              </Button>
            </CardContent>
          </Card>

          <Field id="claim-note" label="Anything else (optional)">
            {(d) => <Input id="claim-note" value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={d} />}
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              Claimed for flowers: <strong>{money(total, current?.currency ?? 'USD')}</strong>
            </p>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Sending…' : 'Send claim'}
            </Button>
          </div>
        </form>
      )}
    </>
  )
}
