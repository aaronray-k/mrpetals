import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, RefreshCw, Search } from 'lucide-react'
import { productLabel, shipmentKeys, useBuyerDirectory, useFarmNames, useProductNames, useShipment, useShipments, type Box } from '~/lib/orders/api'
import type { PrintFormat } from '~/lib/orders/print-boxes'
import { compressPhoto, printBackToFarmSticker, qcRecord, qcScan, uploadQcPhoto, useQcReasons, type QcResult, type ScannedBox } from '~/lib/qc/api'
import { parseScan } from '~/lib/qc/parse'
import { browserStore, flushQueue, type QueueItem, type SendOutcome } from '~/lib/qc/queue'
import { useAuth } from '~/lib/auth'
import { QC_CLEAR_ROLES, QC_ROLES, hasAnyRole } from '~/lib/roles'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { BoxChecklist } from '~/components/qc/box-checklist'
import { QrCamera } from '~/components/qc/qr-camera'
import { ScanResult } from '~/components/qc/scan-result'
import type { FlagInput } from '~/components/qc/qc-result-form'
import { formatDate } from '~/components/orders/shipment-status'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/qc/scan')({
  head: () => ({ meta: [{ title: 'Scan boxes · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={QC_ROLES}>
      <ScanPage />
    </RequireRole>
  ),
})

const SHIPMENT_KEY = 'qc.shipment'
const store = typeof window === 'undefined' ? null : browserStore()

/** Short vibration and beep: one for a good scan, a long double one for a problem. */
function feedback(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 60 : [250, 120, 250])
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 1320 : 220
    gain.gain.value = 0.15
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.45))
    osc.onended = () => void ctx.close()
  } catch {
    /* no sound or vibration on this device */
  }
}

const label = (b: Pick<ScannedBox, 'buyer_box_no' | 'buyer_box_total' | 'box_id'>) =>
  b.buyer_box_no ? `Box ${b.buyer_box_no} of ${b.buyer_box_total}` : `Box ${b.box_id}`

function ScanPage() {
  const { roles } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const shipments = useShipments()
  const reasons = useQcReasons()
  const buyers = useBuyerDirectory()
  const farms = useFarmNames()
  const products = useProductNames()
  const [shipmentId, setShipmentId] = React.useState(() => {
    try {
      return localStorage.getItem(SHIPMENT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const shipment = useShipment(shipmentId)
  const [current, setCurrent] = React.useState<{ box: ScannedBox; local: boolean } | null>(null)
  const [message, setMessage] = React.useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [manual, setManual] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [waiting, setWaiting] = React.useState(0)
  const [problems, setProblems] = React.useState<string[]>([])
  const canClear = hasAnyRole(roles, QC_CLEAR_ROLES)
  const resultRef = React.useRef<HTMLDivElement>(null)
  // On a phone the result is below the camera: bring it into view after each scan.
  React.useEffect(() => {
    const el = resultRef.current
    if (!el || !message) return
    const r = el.getBoundingClientRect()
    if (r.top < 0 || r.top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [message])
  const boxes = shipment.data?.boxes ?? []

  const buyerName = (id: string) => {
    const b = buyers.data?.find((x) => x.id === id)
    return b ? `${b.company_name} (${b.customer_code})` : 'Buyer'
  }
  const farmName = (id: string) => farms.data?.find((f) => f.id === id)?.farm_name ?? 'Farm'
  const productName = (id: string) => {
    const p = products.data?.find((x) => x.id === id)
    return p ? productLabel(p) : 'Product'
  }

  /** A box from the loaded list, in the shape a scan returns (used when offline, or when tapped). */
  const fromList = React.useCallback(
    (b: Box): ScannedBox => {
      const buyer = buyers.data?.find((x) => x.id === b.customer_id)
      const p = products.data?.find((x) => x.id === b.product_id)
      return {
        box_id: b.id,
        status: b.status,
        shipment_id: b.shipment_id,
        shipment_ref: shipment.data?.shipment?.shipment_ref ?? '',
        buyer_box_no: b.buyer_box_no,
        buyer_box_total: b.buyer_box_total,
        farm_box_no: b.farm_box_no,
        farm_box_total: b.farm_box_total,
        customer_name: buyer?.company_name ?? 'Buyer',
        customer_code: buyer?.customer_code ?? '',
        farm_name: farms.data?.find((f) => f.id === b.farm_id)?.farm_name ?? 'Farm',
        variety: p?.variety ?? '',
        flower_type: p?.flower_type ?? '',
        stem_length_cm: p?.stem_length_cm ?? 0,
        grade: p?.grade ?? '',
        stems: b.stems,
        received_at: b.received_at,
        qc_status: b.qc_status,
        qc_severity: b.qc_severity,
        qc_reasons: b.qc_reasons,
        qc_note: b.qc_note,
      }
    },
    [buyers.data, products.data, farms.data, shipment.data],
  )

  const refresh = React.useCallback(() => queryClient.invalidateQueries({ queryKey: shipmentKeys.one(shipmentId) }), [queryClient, shipmentId])

  // Keep the result panel in step with the list after it reloads.
  React.useEffect(() => {
    if (!current || current.local) return
    const b = boxes.find((x) => x.id === current.box.box_id)
    if (b) setCurrent((c) => (c && c.box.box_id === b.id ? { box: { ...c.box, ...fromList(b), scanned_before: c.box.scanned_before, first_scanned_at: c.box.first_scanned_at }, local: false } : c))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment.data])

  // ---------------------------------------------------------------- queue
  const send = React.useCallback(async (item: QueueItem): Promise<SendOutcome> => {
    const p = item.payload
    if (item.kind === 'photo') return uploadQcPhoto(Number(p.boxId), item.blob!, String(p.fileId))
    const r =
      item.kind === 'scan'
        ? await qcScan(String(p.eventId), String(p.shipmentId), Number(p.boxId), String(p.at))
        : await qcRecord(String(p.eventId), p.boxIds as number[], p.result as QcResult, p.reasons as string[], (p.note as string | null) ?? null, String(p.at))
    return r.ok ? { status: 'sent' } : r.retry ? { status: 'retry' } : { status: 'refused', message: r.message }
  }, [])

  const flush = React.useCallback(async () => {
    if (!store) return
    const r = await flushQueue(store, send)
    setWaiting(r.waiting)
    if (r.refused.length) setProblems((ps) => [...ps, ...r.refused.map((x) => `${x.item.label}: ${x.message}`)])
    if (r.sent || r.refused.length) void refresh()
  }, [send, refresh])

  const enqueue = async (item: Omit<QueueItem, 'createdAt'>) => {
    await store?.put({ ...item, createdAt: new Date().toISOString() })
    setWaiting((await store?.all())?.length ?? 0)
  }

  React.useEffect(() => {
    void flush()
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [flush])
  React.useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(() => void flush(), 15000)
    return () => window.clearInterval(t)
  }, [waiting, flush])

  // ---------------------------------------------------------------- actions
  async function scan(text: string) {
    if (!shipmentId) {
      setMessage({ kind: 'error', text: 'Choose the shipment you are checking first.' })
      feedback(false)
      return
    }
    const parsed = parseScan(text)
    if ('error' in parsed) {
      setMessage({ kind: 'error', text: parsed.error })
      feedback(false)
      return
    }
    const eventId = crypto.randomUUID()
    const at = new Date().toISOString()
    const r = await qcScan(eventId, shipmentId, parsed.boxId, at)
    if (r.ok) {
      setCurrent({ box: r.data, local: false })
      setMessage({ kind: 'ok', text: `${label(r.data)}${r.data.scanned_before ? ' (scanned before)' : ''}. ${r.data.farm_name}.` })
      feedback(true)
      void refresh()
    } else if (r.retry) {
      await enqueue({ id: eventId, kind: 'scan', payload: { eventId, shipmentId, boxId: parsed.boxId, at }, label: `Scan of box ${parsed.boxId}` })
      const local = boxes.find((b) => b.id === parsed.boxId)
      if (local) setCurrent({ box: fromList(local), local: true })
      setMessage({
        kind: 'warn',
        text: local
          ? `${label(fromList(local))}. No connection: the scan is saved on this phone and will send by itself.`
          : `No connection. Box ${parsed.boxId} is saved on this phone and will be checked when the connection is back.`,
      })
      feedback(!!local)
    } else {
      setMessage({ kind: 'error', text: r.message })
      feedback(false)
    }
  }

  async function sendPhotos(boxId: number, files: File[]) {
    for (const f of files) {
      const fileId = crypto.randomUUID()
      const blob = await compressPhoto(f)
      const outcome = await uploadQcPhoto(boxId, blob, fileId)
      if (outcome.status === 'retry') await enqueue({ id: fileId, kind: 'photo', payload: { boxId, fileId }, blob, label: `Photo of box ${boxId}` })
      else if (outcome.status === 'refused') setProblems((ps) => [...ps, `Photo of box ${boxId}: ${outcome.message}`])
    }
    void queryClient.invalidateQueries({ queryKey: ['qc-photos', boxId] })
    void refresh()
  }

  async function record(box: ScannedBox, result: QcResult, reasonCodes: string[], note: string | null, photos: File[]) {
    setBusy(true)
    const eventId = crypto.randomUUID()
    const at = new Date().toISOString()
    try {
      const r = await qcRecord(eventId, [box.box_id], result, reasonCodes, note, at)
      if (!r.ok && !r.retry) {
        setMessage({ kind: 'error', text: r.message })
        feedback(false)
        return false
      }
      if (!r.ok) {
        await enqueue({ id: eventId, kind: 'result', payload: { eventId, boxIds: [box.box_id], result, reasons: reasonCodes, note, at }, label: `QC result for box ${box.box_id}` })
      }
      if (photos.length) await sendPhotos(box.box_id, photos)
      const words = { pass: 'passed', minor: 'passed with a Minor note', major: 'failed (Major)', critical: 'goes BACK TO FARM' }[result]
      setMessage({ kind: r.ok ? 'ok' : 'warn', text: `${label(box)} ${words}.${r.ok ? '' : ' Saved on this phone; it will send by itself.'}` })
      feedback(true)
      if (r.ok) {
        // Show the new state at once; the list reload fills in the new numbers.
        setCurrent({
          box: {
            ...box,
            qc_status: result === 'pass' || result === 'minor' ? 'passed' : 'failed',
            qc_severity: result === 'pass' ? null : result,
            qc_reasons: result === 'pass' ? [] : reasonCodes,
            qc_note: note,
            status: result === 'critical' ? 'back_to_farm' : box.status,
          },
          local: false,
        })
        await refresh()
      }
      return true
    } finally {
      setBusy(false)
    }
  }

  const openShipments = (shipments.data ?? []).filter((s) => s.status === 'open' || s.id === shipmentId)
  const currentListBox = current ? boxes.find((b) => b.id === current.box.box_id) : undefined

  return (
    <>
      <PageHeader title="Scan boxes" description="Scan each box at QC. The scan receives the box and ticks it on the packing list." />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="qc.scan" title="Scan, check, done">
          Point the camera at the box label's QR code, or type the 8-digit box id. Then tap <strong>Pass</strong>, or choose Minor, Major or{' '}
          <strong>Back to farm</strong> with the reasons. Boxes sent back get a BACK TO FARM sticker.
        </Tip>

        <Field id="qc-shipment" label="Shipment you are checking">
          {(d) => (
            <Select
              id="qc-shipment"
              value={shipmentId}
              aria-describedby={d}
              onChange={(e) => {
                setShipmentId(e.target.value)
                setCurrent(null)
                setMessage(null)
                try {
                  localStorage.setItem(SHIPMENT_KEY, e.target.value)
                } catch {
                  /* not remembered; fine */
                }
              }}
            >
              <option value="">Choose a shipment…</option>
              {openShipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shipment_ref} · {s.flight_no ?? 'flight not set'} · {formatDate(s.flight_date)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {(waiting > 0 || problems.length > 0) && (
          <Alert variant={problems.length ? 'destructive' : 'warning'} title={waiting ? `${waiting} ${waiting === 1 ? 'item' : 'items'} waiting to send` : 'Some saved scans were refused'} role="status">
            <div className="grid gap-2">
              {waiting > 0 && (
                <p className="flex items-center gap-1.5">
                  <CloudOff className="size-4" aria-hidden="true" /> Saved on this phone. They send by themselves when the connection is back.
                </p>
              )}
              {problems.length > 0 && (
                <ul className="list-disc pl-5">
                  {problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                {waiting > 0 && (
                  <Button size="sm" variant="outline" onClick={() => void flush()}>
                    <RefreshCw aria-hidden="true" /> Send now
                  </Button>
                )}
                {problems.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setProblems([])}>
                    Clear the list
                  </Button>
                )}
              </div>
            </div>
          </Alert>
        )}

        {shipmentId && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
            <Card className="grid gap-3 p-4">
              <QrCamera onCode={(t) => void scan(t)} />
              <form
                className="grid gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void scan(manual)
                  setManual('')
                }}
              >
                <label htmlFor="qc-manual" className="text-sm font-semibold">
                  Box id or scanned code
                </label>
                <div className="flex gap-2">
                  <Input id="qc-manual" value={manual} inputMode="numeric" autoComplete="off" onChange={(e) => setManual(e.target.value)} placeholder="e.g. 10000042" />
                  <Button type="submit" variant="outline">
                    <Search aria-hidden="true" /> Check
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">A handheld scanner types here too.</p>
              </form>
            </Card>

            <div ref={resultRef} className="grid scroll-mt-20 gap-3">
              <div aria-live="assertive" className="contents">
                {message?.kind === 'error' && (
                  <p className="rounded-lg border-2 border-destructive bg-destructive/10 p-4 text-lg font-bold text-destructive" role="alert">
                    {message.text}
                  </p>
                )}
              </div>
              <div aria-live="polite" className="contents">
                {message && message.kind !== 'error' && (
                  <p className={message.kind === 'warn' ? 'rounded-lg border border-warning/40 bg-warning-bg p-3 font-semibold' : 'sr-only'}>{message.text}</p>
                )}
              </div>
              {current && reasons.data && (
                <ScanResult
                  box={current.box}
                  local={current.local}
                  photoCount={currentListBox?.photo_count ?? 0}
                  reasons={reasons.data}
                  canClear={canClear}
                  busy={busy}
                  onPass={() => void record(current.box, 'pass', [], null, [])}
                  onFlag={(input: FlagInput) => record(current.box, input.result, input.reasons, input.note, input.photos)}
                  onPhotos={(files) => void sendPhotos(current.box.box_id, files)}
                  onSticker={async (format: PrintFormat) => {
                    try {
                      await printBackToFarmSticker(current.box.box_id, format)
                      toast({ kind: 'success', title: 'BACK TO FARM sticker ready' })
                    } catch (e) {
                      toast({ kind: 'error', title: 'Sticker not printed', description: (e as Error).message })
                    }
                  }}
                />
              )}
              {!current && <p className="text-muted-foreground">Scan a box to see it here.</p>}
            </div>
          </div>
        )}

        {shipmentId && shipment.isLoading && <Spinner />}
        {shipment.error && (
          <Alert variant="destructive" title="Couldn't load the boxes" role="alert">
            {(shipment.error as Error).message}
          </Alert>
        )}
        {shipmentId && shipment.data && (
          <BoxChecklist
            boxes={boxes}
            buyerName={buyerName}
            farmName={farmName}
            productName={productName}
            currentId={current?.box.box_id ?? null}
            onPick={(b) => {
              setCurrent({ box: fromList(b), local: false })
              setMessage(null)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        )}
      </div>
    </>
  )
}
