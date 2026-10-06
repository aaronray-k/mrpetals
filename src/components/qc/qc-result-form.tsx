import * as React from 'react'
import { Camera, X } from 'lucide-react'
import type { QcReason } from '~/lib/qc/api'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/input'
import { cn } from '~/lib/utils'
import { SEVERITIES } from './qc-badge'

export type FlagSeverity = (typeof SEVERITIES)[number]['id']

export interface FlagInput {
  result: FlagSeverity
  reasons: string[]
  note: string | null
  photos: File[]
}

/** Severity, reasons from the claim policy, a note and photos for a box that isn't a clean pass. */
export function QcResultForm({
  initial,
  reasons,
  allowPhotos = true,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: FlagSeverity
  reasons: QcReason[]
  allowPhotos?: boolean
  busy?: boolean
  onSubmit: (input: FlagInput) => void
  onCancel: () => void
}) {
  const [result, setResult] = React.useState<FlagSeverity>(initial)
  const [picked, setPicked] = React.useState<string[]>([])
  const [note, setNote] = React.useState('')
  const [photos, setPhotos] = React.useState<File[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const previews = React.useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos])
  React.useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  const id = React.useId()

  const criticalOnly = reasons.filter((r) => picked.includes(r.code) && r.critical_only)
  const needNote = reasons.filter((r) => picked.includes(r.code) && r.needs_note)

  function toggle(code: string) {
    const r = reasons.find((x) => x.code === code)
    setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]))
    // Pests always mean BACK TO FARM.
    if (r?.critical_only && !picked.includes(code)) setResult('critical')
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!picked.length) return setError('Choose at least one reason.')
    if (criticalOnly.length && result !== 'critical') return setError(`${criticalOnly.map((r) => r.label).join(', ')} always means BACK TO FARM. Choose Critical.`)
    if (needNote.length && note.trim().length < 3) return setError(`Add a note for: ${needNote.map((r) => r.label).join(', ')}.`)
    setError(null)
    onSubmit({ result, reasons: picked, note: note.trim() || null, photos })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">How serious?</legend>
        {SEVERITIES.map((s) => {
          const Icon = s.icon
          const disabled = criticalOnly.length > 0 && s.id !== 'critical'
          return (
            <label
              key={s.id}
              className={cn(
                'flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <input type="radio" name={`${id}-severity`} className="mt-1 size-5 accent-accent" checked={result === s.id} disabled={disabled} onChange={() => setResult(s.id)} />
              <span className="grid">
                <span className="flex items-center gap-1.5 font-bold">
                  <Icon className="size-4" aria-hidden="true" /> {s.label}
                </span>
                <span className="text-sm text-muted-foreground">{s.help}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-semibold">Reasons (from the claim policy)</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {reasons.map((r) => (
            <label key={r.code} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="checkbox" className="size-6 shrink-0 accent-accent" checked={picked.includes(r.code)} onChange={() => toggle(r.code)} />
              <span>
                {r.label}
                {r.critical_only && <span className="block text-sm font-semibold text-destructive">Always BACK TO FARM</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-note`}>Note{needNote.length ? '' : ' (optional)'}</Label>
        <textarea
          id={`${id}-note`}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Thrips on 2 bunches"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-base"
        />
      </div>

      {allowPhotos && (
        <div className="grid gap-2">
          <span className="text-sm font-semibold">Photos for claims (optional)</span>
          {previews.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {previews.map((u, i) => (
                <li key={u} className="relative">
                  <img src={u} alt={`Photo ${i + 1}`} className="size-20 rounded-md border object-cover" />
                  <button
                    type="button"
                    className="absolute -top-2 -right-2 inline-flex size-7 items-center justify-center rounded-full border bg-card"
                    onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" aria-hidden="true" />
                    <span className="sr-only">Remove photo {i + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="inline-flex h-11 w-fit cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-4 font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <Camera className="size-4" aria-hidden="true" /> Take or add photos
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                setPhotos((ps) => [...ps, ...files])
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}

      {error && (
        <p className="text-sm font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant={result === 'critical' ? 'destructive' : 'default'} disabled={busy}>
          {busy ? 'Saving…' : result === 'critical' ? 'Send back to farm' : `Record ${result}`}
        </Button>
      </div>
    </form>
  )
}
