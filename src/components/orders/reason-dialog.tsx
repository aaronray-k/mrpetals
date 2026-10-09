import * as React from 'react'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Field } from '~/components/ui/input'

/** Asks for a short reason (void, reprint, decline, QC fail) before running an action. */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  label,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: React.ReactNode
  label: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (open) {
      setReason('')
      setError(null)
    }
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) {
      setError('Write a few words (at least 3 characters).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {error && <Alert variant="destructive" title={error} role="alert" />}
        <Field id="reason" label={label}>
          {(d) => (
            <textarea
              id="reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={d}
              autoFocus
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-base"
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
