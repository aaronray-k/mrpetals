import { rgbaToMono, type MonoBitmap } from './bitmap'
import type { LogoVariant } from './layout'

/** ConsolFlora artwork, from consolflora.com. Replace these files to change the logo on every label. */
export const LOGO_URLS: Record<LogoVariant, string> = {
  full: '/labels/consolflora-logo-full.png',
  mark: '/labels/consolflora-logo-mark.png',
}

interface LoadedLogos {
  images: Record<LogoVariant, HTMLImageElement>
  pngs: Record<LogoVariant, ArrayBuffer>
}

let loading: Promise<LoadedLogos> | null = null

/** Loads both logos once per page: as images (for Zebra bitmaps) and as PNG bytes (for PDFs). */
export function loadLogos(): Promise<LoadedLogos> {
  loading ??= (async () => {
    const variants = Object.keys(LOGO_URLS) as LogoVariant[]
    const entries = await Promise.all(
      variants.map(async (v) => {
        const res = await fetch(LOGO_URLS[v])
        if (!res.ok) throw new Error(`Could not load the ${v} logo.`)
        const bytes = await res.arrayBuffer()
        const image = new Image()
        image.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
        await image.decode()
        return [v, image, bytes] as const
      }),
    )
    return {
      images: Object.fromEntries(entries.map(([v, img]) => [v, img])) as Record<LogoVariant, HTMLImageElement>,
      pngs: Object.fromEntries(entries.map(([v, , bytes]) => [v, bytes])) as Record<LogoVariant, ArrayBuffer>,
    }
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

/** Black-and-white logo at an exact size in printer dots, for ZPL. */
export function logoBitmapProvider(images: LoadedLogos['images']) {
  return (variant: LogoVariant, width: number, height: number): MonoBitmap => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(images[variant], 0, 0, width, height)
    return rgbaToMono(ctx.getImageData(0, 0, width, height).data, width, height)
  }
}
