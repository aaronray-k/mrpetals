import * as React from 'react'
import { Images } from 'lucide-react'
import { useBoxPhotos } from '~/lib/qc/api'
import { formatDateTime } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'

/** "2 photos" button that opens a box's QC photos. */
export function BoxPhotosButton({ boxId, count, label }: { boxId: number; count: number; label?: string }) {
  const [open, setOpen] = React.useState(false)
  if (!count) return null
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Images aria-hidden="true" /> {count} {count === 1 ? 'photo' : 'photos'}
        <span className="sr-only"> of box {boxId}</span>
      </Button>
      {open && <PhotosDialog boxId={boxId} title={label ?? `Photos of box ${boxId}`} onClose={() => setOpen(false)} />}
    </>
  )
}

function PhotosDialog({ boxId, title, onClose }: { boxId: number; title: string; onClose: () => void }) {
  const photos = useBoxPhotos(boxId)
  return (
    <Dialog open onClose={onClose} title={title} className="w-[min(48rem,calc(100vw-2rem))]">
      {photos.isLoading && <Spinner />}
      {photos.error && <p role="alert">{(photos.error as Error).message}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {photos.data?.map((p, i) => (
          <li key={p.id} className="grid gap-1">
            {p.url ? <img src={p.url} alt={`QC photo ${i + 1} of box ${boxId}`} className="w-full rounded-md border" /> : <p>Photo not available.</p>}
            <span className="text-sm text-muted-foreground">{formatDateTime(p.taken_at)}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
