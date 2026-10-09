import * as React from 'react'
import { Ban, CheckCircle2, Printer, RotateCcw, Truck, Undo2, XCircle } from 'lucide-react'
import { receiveBoxes, voidBox, type Box } from '~/lib/orders/api'
import { printBackToFarmSticker, qcRecord, useQcReasons } from '~/lib/qc/api'
import { BoxPhotosButton } from '~/components/qc/box-photos'
import { QcBadge, reasonLabels } from '~/components/qc/qc-badge'
import { QcResultForm } from '~/components/qc/qc-result-form'
import { Dialog } from '~/components/ui/dialog'
import { printBoxLabels, type PrintFormat } from '~/lib/orders/print-boxes'
import { Button } from '~/components/ui/button'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'
import { cn } from '~/lib/utils'
import { ReasonDialog } from './reason-dialog'
import { LabelStatus, ReceivedStatus, boxNumber } from './status'

const FORMATS: { id: string; label: string; format: PrintFormat }[] = [
  { id: 'pdf', label: 'PDF', format: { kind: 'pdf' } },
  { id: 'zpl203', label: 'ZPL 203 dpi', format: { kind: 'zpl', dpi: 203 } },
  { id: 'zpl300', label: 'ZPL 300 dpi', format: { kind: 'zpl', dpi: 300 } },
]

const isActive = (b: Box) => b.status === 'active'
/** Ready for its first label: received and passed QC (the farm confirmed it, or it would have no box). */
const readyToPrint = (b: Box) => isActive(b) && !!b.received_at && b.qc_status === 'passed' && !b.last_printed_at

export function BoxesTable({
  boxes,
  farmName,
  productName,
  can,
  fileBase,
  onChanged,
}: {
  boxes: Box[]
  farmName: (id: string) => string
  productName: (id: string) => string
  can: { receive: boolean; qc: boolean; print: boolean; void: boolean; clearQc?: boolean }
  /** Start of downloaded label file names, e.g. "SHP-2026-0001-PFJ-labels". */
  fileBase: string
  onChanged: () => void
}) {
  const toast = useToast()
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [formatId, setFormatId] = React.useState('pdf')
  const [busy, setBusy] = React.useState(false)
  const [dialog, setDialog] = React.useState<null | 'void' | 'reprint' | 'qc-fail'>(null)

  // Forget selections of boxes that are no longer listed.
  React.useEffect(() => {
    setSelected((s) => new Set([...s].filter((id) => boxes.some((b) => b.id === id))))
  }, [boxes])

  const chosen = boxes.filter((b) => selected.has(b.id))
  const toReceive = chosen.filter((b) => isActive(b) && !b.received_at)
  const toQc = chosen.filter((b) => isActive(b) && !!b.received_at)
  // Passing never overwrites a QC failure by accident: failed boxes pass only when they are all that is selected (re-inspection).
  // Failed boxes pass only on purpose (all of the selection) and only for Senior QC or Admin.
  const toPass = can.clearQc && toQc.every((b) => b.qc_status === 'failed') ? toQc : toQc.filter((b) => b.qc_status !== 'failed')
  const reasons = useQcReasons()
  const toPrint = chosen.filter(readyToPrint)
  const toReprint = chosen.filter((b) => isActive(b) && !!b.last_printed_at && !!b.received_at && b.qc_status === 'passed')
  const toVoid = chosen.filter(isActive)
  const format = FORMATS.find((f) => f.id === formatId)!.format
  const outOfDate = boxes.filter((b) => b.label_out_of_date).length

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectWhere = (pick: (b: Box) => boolean) => setSelected(new Set(boxes.filter(pick).map((b) => b.id)))

  async function run(title: string, fn: () => Promise<string | void>) {
    setBusy(true)
    try {
      const detail = await fn()
      toast({ kind: 'success', title, description: detail || undefined })
      setSelected(new Set())
      onChanged()
    } catch (e) {
      toast({ kind: 'error', title: `${title.split(' ')[0]} failed`, description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function qc(ids: number[], result: 'pass' | 'minor' | 'major' | 'critical', codes: string[], note: string | null) {
    const r = await qcRecord(crypto.randomUUID(), ids, result, codes, note, new Date().toISOString())
    if (!r.ok) throw new Error(r.retry ? 'No connection. Try again.' : r.message)
    return r.data
  }

  const n = (count: number, one: string, many = one.endsWith('x') ? `${one}es` : `${one}s`) => `${count} ${count === 1 ? one : many}`

  return (
    <div className="grid grid-cols-1 gap-3">
      {outOfDate > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning-bg p-3 text-sm font-semibold" role="status">
          {n(outOfDate, 'label')} {outOfDate === 1 ? 'shows' : 'show'} old box numbers. Reprint{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => selectWhere((b) => b.label_out_of_date)}>
            {outOfDate === 1 ? 'it' : 'them'}
          </button>
          .
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Select:</span>
        <Button variant="ghost" size="sm" onClick={() => selectWhere(isActive)}>
          All
        </Button>
        {can.print && (
          <Button variant="ghost" size="sm" onClick={() => selectWhere(readyToPrint)}>
            Ready to print ({boxes.filter(readyToPrint).length})
          </Button>
        )}
        {can.receive && (
          <Button variant="ghost" size="sm" onClick={() => selectWhere((b) => isActive(b) && !b.received_at)}>
            Not received
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
          None
        </Button>
        <span className="ml-auto text-muted-foreground" role="status">
          {selected.size} selected
        </span>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/60 p-3" role="toolbar" aria-label="Actions for the selected boxes">
          {can.receive && (
            <Button size="sm" variant="outline" disabled={busy || !toReceive.length} onClick={() => run('Boxes received', async () => `${n(await receiveBoxes(toReceive.map((b) => b.id)), 'box')} marked received.`)}>
              <Truck aria-hidden="true" /> Received ({toReceive.length})
            </Button>
          )}
          {can.qc && (
            <>
              <Button size="sm" variant="outline" disabled={busy || !toPass.length} onClick={() => run('QC passed', async () => `${n(await qc(toPass.map((b) => b.id), 'pass', [], null), 'box')} passed.`)}>
                <CheckCircle2 aria-hidden="true" /> QC passed ({toPass.length})
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !toQc.length} onClick={() => setDialog('qc-fail')}>
                <XCircle aria-hidden="true" /> Flag…
              </Button>
            </>
          )}
          {can.print && (
            <>
              <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
              <fieldset className="flex items-center gap-1 rounded-md border border-input bg-card p-1">
                <legend className="sr-only">Label file</legend>
                {FORMATS.map((f) => (
                  <label key={f.id} className={cn('inline-flex h-8 cursor-pointer items-center rounded px-2 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', formatId === f.id && 'bg-accent/20')}>
                    <input type="radio" name="label-format" value={f.id} checked={formatId === f.id} onChange={() => setFormatId(f.id)} className="sr-only" />
                    {f.label}
                  </label>
                ))}
              </fieldset>
              <Button size="sm" disabled={busy || !toPrint.length} onClick={() => run('Labels ready', async () => {
                const r = await printBoxLabels(toPrint.map((b) => b.id), null, format, `${fileBase}-labels`)
                return `${n(r.count, 'label')} downloaded.`
              })}>
                <Printer aria-hidden="true" /> Print labels ({toPrint.length})
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !toReprint.length} onClick={() => setDialog('reprint')}>
                <RotateCcw aria-hidden="true" /> Reprint ({toReprint.length})…
              </Button>
            </>
          )}
          {can.void && (
            <Button size="sm" variant="outline" className="sm:ml-auto" disabled={busy || !toVoid.length} onClick={() => setDialog('void')}>
              <Ban aria-hidden="true" /> Void ({toVoid.length})…
            </Button>
          )}
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <caption className="sr-only">Boxes</caption>
          <THead>
            <TR>
              <TH className="w-12">
                <span className="sr-only">Select</span>
                <input
                  type="checkbox"
                  aria-label="Select all boxes"
                  className="size-6 accent-accent"
                  checked={boxes.length > 0 && boxes.filter(isActive).every((b) => selected.has(b.id))}
                  onChange={(e) => (e.target.checked ? selectWhere(isActive) : setSelected(new Set()))}
                />
              </TH>
              <TH>Box</TH>
              <TH>Farm box</TH>
              <TH>Box ID</TH>
              <TH>Product</TH>
              <TH className="text-right">Stems</TH>
              <TH>Received</TH>
              <TH>QC</TH>
              <TH>Label</TH>
            </TR>
          </THead>
          <TBody>
            {boxes.map((b) => (
              <TR key={b.id} className={cn(b.status === 'void' && 'text-muted-foreground', selected.has(b.id) && 'bg-accent/10')}>
                <TD>
                  <input
                    type="checkbox"
                    className="size-6 accent-accent"
                    aria-label={`Select box ${b.status === 'active' ? boxNumber(b.buyer_box_no, b.buyer_box_total) : b.id}`}
                    checked={selected.has(b.id)}
                    disabled={b.status !== 'active'}
                    onChange={() => toggle(b.id)}
                  />
                </TD>
                <TD className="font-semibold whitespace-nowrap tabular-nums">
                  {b.status === 'void' ? (
                    <span className="inline-flex items-center gap-1">
                      <Ban className="size-4" aria-hidden="true" /> Void
                    </span>
                  ) : b.status === 'back_to_farm' ? (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <Undo2 className="size-4" aria-hidden="true" /> Back to farm
                    </span>
                  ) : (
                    boxNumber(b.buyer_box_no, b.buyer_box_total)
                  )}
                </TD>
                <TD className="whitespace-nowrap">
                  {b.status !== 'active' ? (
                    <span className="text-sm">{b.void_reason}</span>
                  ) : (
                    <>
                      <span className="tabular-nums">{boxNumber(b.farm_box_no, b.farm_box_total)}</span>
                      <span className="block text-sm text-muted-foreground">{farmName(b.farm_id)}</span>
                    </>
                  )}
                </TD>
                <TD className="font-mono text-sm tabular-nums">{b.id}</TD>
                <TD className="min-w-48">{productName(b.product_id)}</TD>
                <TD className="text-right tabular-nums">{b.stems}</TD>
                <TD className="whitespace-nowrap">
                  <ReceivedStatus box={b} />
                </TD>
                <TD className="min-w-40">
                  {b.status === 'void' ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="grid justify-items-start gap-1">
                      <QcBadge box={b} />
                      {b.qc_reasons.length > 0 && <span className="text-sm">{reasonLabels(b.qc_reasons, reasons.data).join(', ')}</span>}
                      {b.qc_note && <span className="text-sm text-muted-foreground">{b.qc_note}</span>}
                      <BoxPhotosButton boxId={b.id} count={b.photo_count} />
                    </div>
                  )}
                </TD>
                <TD className="whitespace-nowrap">
                  {b.status === 'back_to_farm' ? (
                    can.qc ? (
                      <Button size="sm" variant="outline" onClick={() => run('Sticker ready', async () => void (await printBackToFarmSticker(b.id, format)))}>
                        <Printer aria-hidden="true" /> BACK TO FARM sticker<span className="sr-only"> for box {b.id}</span>
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )
                  ) : (
                    <LabelStatus box={b} />
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <ReasonDialog
        open={dialog === 'void'}
        onClose={() => setDialog(null)}
        title={`Void ${n(toVoid.length, 'box')}`}
        description="The box keeps its id, but stops counting. While the shipment is open, the boxes after it move up a number."
        label="Why is it void?"
        confirmLabel="Void"
        destructive
        onConfirm={async (reason) => {
          for (const b of toVoid) await voidBox(b.id, reason)
          toast({ kind: 'success', title: `${n(toVoid.length, 'box')} voided` })
          setSelected(new Set())
          onChanged()
        }}
      />
      <ReasonDialog
        open={dialog === 'reprint'}
        onClose={() => setDialog(null)}
        title={`Reprint ${n(toReprint.length, 'label')}`}
        description="Reprints keep the same box id and carry a REPRINT mark. The reason is logged with your name."
        label="Why reprint?"
        confirmLabel="Reprint"
        onConfirm={async (reason) => {
          const r = await printBoxLabels(toReprint.map((b) => b.id), reason, format, `${fileBase}-reprint`)
          toast({ kind: 'success', title: 'Reprint ready', description: `${n(r.count, 'label')} downloaded.` })
          setSelected(new Set())
          onChanged()
        }}
      />
      <Dialog
        open={dialog === 'qc-fail'}
        onClose={() => setDialog(null)}
        title={`Flag ${n(toQc.length, 'box')}`}
        description="Photos can be added box by box on the Scan boxes page."
        className="w-[min(44rem,calc(100vw-2rem))]"
      >
        {reasons.data && (
          <QcResultForm
            initial="major"
            reasons={reasons.data}
            allowPhotos={false}
            busy={busy}
            onCancel={() => setDialog(null)}
            onSubmit={(input) => {
              setDialog(null)
              void run('QC recorded', async () => `${n(await qc(toQc.map((b) => b.id), input.result, input.reasons, input.note), 'box')} flagged ${input.result}.`)
            }}
          />
        )}
      </Dialog>
    </div>
  )
}
