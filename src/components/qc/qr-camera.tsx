import * as React from 'react'
import { Camera, CameraOff } from 'lucide-react'
import { Button } from '~/components/ui/button'

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

/** Android Chrome reads QR codes itself; elsewhere jsQR reads the camera frames. */
async function makeReader(): Promise<(video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>> {
  const BD = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
  const formats: string[] = BD ? ((await BD.getSupportedFormats?.().catch(() => [] as string[])) ?? []) : []
  if (BD && formats.includes('qr_code')) {
    const detector = new BD({ formats: ['qr_code'] })
    return async (video) => (await detector.detect(video).catch(() => []))[0]?.rawValue ?? null
  }
  const { default: jsQR } = await import('jsqr')
  return async (video, canvas) => {
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return null
    const scale = Math.min(1, 800 / Math.max(w, h))
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

/**
 * Camera scanner. Calls onCode once per code; the same code is ignored for 3 seconds so holding
 * the phone over a label doesn't scan it twice.
 */
export function QrCamera({ onCode }: { onCode: (text: string) => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [on, setOn] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const onCodeRef = React.useRef(onCode)
  onCodeRef.current = onCode

  React.useEffect(() => {
    if (!on) return
    let stream: MediaStream | null = null
    let stopped = false
    let last = { text: '', at: 0 }
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch (e) {
        setError(
          (e as Error).name === 'NotAllowedError'
            ? 'The camera is blocked. Allow camera access for this site in Chrome, or type the box id below.'
            : 'No camera found. Type the box id below, or use a handheld scanner.',
        )
        setOn(false)
        return
      }
      const video = videoRef.current!
      video.srcObject = stream
      await video.play().catch(() => {})
      const read = await makeReader()
      while (!stopped) {
        const text = await read(video, canvasRef.current!)
        const now = Date.now()
        if (text && (text !== last.text || now - last.at > 3000)) {
          last = { text, at: now }
          onCodeRef.current(text)
        }
        await new Promise((r) => setTimeout(r, 150))
      }
    })()
    return () => {
      stopped = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [on])

  return (
    <div className="grid gap-2">
      {on ? (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Camera view" />
          <div className="pointer-events-none absolute inset-[18%] rounded-lg border-4 border-white/80" aria-hidden="true" />
        </div>
      ) : null}
      <canvas ref={canvasRef} className="hidden" />
      <Button
        size="lg"
        variant={on ? 'outline' : 'default'}
        onClick={() => {
          setError(null)
          setOn((v) => !v)
        }}
      >
        {on ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
        {on ? 'Stop camera' : 'Scan with camera'}
      </Button>
      {error && (
        <p className="text-sm font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
