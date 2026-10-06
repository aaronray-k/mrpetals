import * as React from 'react'
import { Camera, CheckCircle2, Printer, Undo2 } from 'lucide-react'
import type { QcReason, ScannedBox } from '~/lib/qc/api'
import type { PrintFormat } from '~/lib/orders/print-boxes'
import { formatDateTime } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { boxNumber } from '~/components/orders/status'
import { BoxPhotosButton } from './box-photos'
import { QcBadge, SEVERITIES, reasonLabels } from './qc-badge'
import { QcResultForm, type FlagInput, type FlagSeverity } from './qc-result-form'

export const STICKER_FORMATS: { id: string; label: string; format: PrintFormat }[] = [
  { id: 'pdf', label: 'PDF', format: { kind: 'pdf' } },
  { id: 'zpl203', label: 'ZPL 203 dpi', format: { kind: 'zpl', dpi: 203 } },
  { id: 'zpl300', label: 'ZPL 300 dpi', format: { kind: 'zpl', dpi: 300 } },
]

/** The box just scanned: its number in big type, what's in it, and the QC buttons. */
export function ScanResult({
  box,
  photoCount,
  reasons,
  canClear,
  busy,
  local,
  onPass,
  onFlag,
  onPhotos,
  onSticker,
}: {
  box: ScannedBox
  photoCount: number
  reasons: QcReason[]
  canClear: boolean
  busy: boolean
  /** Shown from the phone's copy of the list because the connection is down. */
  local: boolean
  onPass: () => void
  onFlag: (input: FlagInput) => Promise<boolean>
  onPhotos: (files: File[]) => void
  onSticker: (format: PrintFormat) => void
}) {
  const [flagging, setFlagging] = React.useState<FlagSeverity | null>(null)
  const [formatId, setFormatId] = React.useState(() => {
    try {
      return localStorage.getItem('qc.stickerFormat') ?? 'pdf'
    } catch {
      return 'pdf'
    }
  })
  React.useEffect(() => setFlagging(null), [box.box_id])
  const returned = box.status === 'back_to_farm'
  const blockedByMajor = box.qc_status === 'failed' && !canClear
  const notReceived = !box.received_at
  const headingId = `box-${box.box_id}`

  return (
    <section aria-labelledby={headingId} className={cn('grid gap-4 rounded-xl border-2 bg-card p-4 sm:p-6', returned ? 'border-destructive' : 'border-primary/40')}>
      <div className="grid gap-1">
        <h2 id={headingId} className="text-5xl leading-none font-black tracking-tight tabular-nums sm:text-6xl">
          {returned ? 'BACK TO FARM' : box.buyer_box_no ? `Box ${box.buyer_box_no} of ${box.buyer_box_total}` : `Box ${box.box_id}`}
        </h2>
        <p className="text-lg font-bold">
          {box.customer_name} ({box.customer_code})
        </p>
        <p className="text-lg">
          {box.farm_box_no ? <>Farm box {boxNumber(box.farm_box_no, box.farm_box_total)} · </> : null}
          {box.farm_name}
        </p>
        <p>
          {box.variety} · {box.flower_type} · {box.stem_length_cm} cm · {box.grade} · <strong>{box.stems} stems</strong>
        </p>
        <p className="font-mono text-sm text-muted-foreground">
          Box ID {box.box_id} · {box.shipment_ref}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <QcBadge box={box} />
        {box.qc_reasons.length > 0 && <span className="text-sm">{reasonLabels(box.qc_reasons, reasons).join(', ')}</span>}
        {box.qc_note && <span className="text-sm text-muted-foreground">“{box.qc_note}”</span>}
        <BoxPhotosButton boxId={box.box_id} count={photoCount} />
      </div>
      {box.scanned_before && box.first_scanned_at && (
        <p className="text-sm font-semibold">Scanned before, first at {formatDateTime(box.first_scanned_at)}.</p>
      )}
      {local && <p className="text-sm font-semibold text-warning">No connection: shown from this phone's copy of the list.</p>}

      {returned ? (
        <div className="grid gap-3">
          <p className="flex items-center gap-2 font-semibold text-destructive">
            <Undo2 className="size-5" aria-hidden="true" /> Put this box aside. Stick the BACK TO FARM sticker on it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <fieldset className="flex items-center gap-1 rounded-md border border-input bg-card p-1">
              <legend className="sr-only">Sticker file</legend>
              {STICKER_FORMATS.map((f) => (
                <label key={f.id} className={cn('inline-flex h-9 cursor-pointer items-center rounded px-2 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', formatId === f.id && 'bg-accent/20')}>
                  <input
                    type="radio"
                    name="sticker-format"
                    className="sr-only"
                    checked={formatId === f.id}
                    onChange={() => {
                      setFormatId(f.id)
                      try {
                        localStorage.setItem('qc.stickerFormat', f.id)
                      } catch {
                        /* not saved; fine */
                      }
                    }}
                  />
                  {f.label}
                </label>
              ))}
            </fieldset>
            <Button size="lg" variant="destructive" disabled={busy || local} onClick={() => onSticker(STICKER_FORMATS.find((f) => f.id === formatId)!.format)}>
              <Printer aria-hidden="true" /> Print BACK TO FARM sticker
            </Button>
          </div>
        </div>
      ) : notReceived ? (
        <p className="font-semibold">Scan this box's label to receive it before checking it.</p>
      ) : flagging ? (
        <QcResultForm
          initial={flagging}
          reasons={reasons}
          busy={busy}
          onCancel={() => setFlagging(null)}
          onSubmit={async (input) => {
            if (await onFlag(input)) setFlagging(null)
          }}
        />
      ) : (
        <div className="grid gap-2">
          <Button size="lg" className="h-14 text-lg" disabled={busy || blockedByMajor} onClick={onPass}>
            <CheckCircle2 aria-hidden="true" /> {box.qc_status === 'failed' ? 'Clear: passed after re-check' : 'Pass'}
          </Button>
          {blockedByMajor && <p className="text-sm font-semibold">This box failed QC (Major). Only a Senior QC or an Admin can clear it.</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            {SEVERITIES.map((s) => {
              const Icon = s.icon
              return (
                <Button key={s.id} size="lg" variant={s.id === 'critical' ? 'destructive' : 'outline'} disabled={busy} onClick={() => setFlagging(s.id)}>
                  <Icon aria-hidden="true" /> {s.id === 'critical' ? 'Back to farm…' : `${s.label}…`}
                </Button>
              )
            })}
          </div>
          <label className="inline-flex h-11 w-fit cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-semibold hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <Camera className="size-4" aria-hidden="true" /> Add photos to this box
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (files.length) onPhotos(files)
              }}
            />
          </label>
        </div>
      )}
    </section>
  )
}
