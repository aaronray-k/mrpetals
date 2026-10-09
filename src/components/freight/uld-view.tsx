import * as React from 'react'
import type { PackResult, Uld } from '~/lib/freight/packing'

/**
 * The container and its boxes in 3D: drag to turn, scroll or pinch to zoom. Layers alternate two greens; layers
 * above `upTo` are hidden so the ones below can be seen. three.js is loaded only on this page.
 */
export function UldView({ uld, plan, upTo, className }: { uld: Uld; plan: PackResult; upTo: number; className?: string }) {
  const host = React.useRef<HTMLDivElement>(null)
  const scene = React.useRef<{ setLayers: (n: number) => void; dispose: () => void } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const THREE = await import('three')
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
      const el = host.current
      if (!el || cancelled) return
      const s = 1 / 1000 // mm → m
      const W = Math.max(uld.width, uld.fullWidth ?? 0)
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(el.clientWidth, el.clientHeight)
      el.appendChild(renderer.domElement)
      renderer.domElement.setAttribute('aria-hidden', 'true')
      const sc = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.01, 100)
      const centre = new THREE.Vector3((W / 2) * s, (uld.height / 2) * s, (uld.depth / 2) * s)
      camera.position.set(centre.x + W * s * 1.6, centre.y + uld.height * s * 1.1, centre.z + uld.depth * s * 2.2)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.copy(centre)
      controls.enableDamping = true
      sc.add(new THREE.AmbientLight(0xffffff, 0.75))
      const sun = new THREE.DirectionalLight(0xffffff, 0.9)
      sun.position.set(3, 5, 4)
      sc.add(sun)

      // The container: its cross-section (with the AKE wing) drawn front to back.
      const shape = new THREE.Shape()
      shape.moveTo(0, 0)
      shape.lineTo(uld.width * s, 0)
      if (uld.fullWidth && uld.wingTop) shape.lineTo(uld.fullWidth * s, uld.wingTop * s)
      shape.lineTo(W * s, uld.height * s)
      shape.lineTo(0, uld.height * s)
      shape.lineTo(0, 0)
      const shell = new THREE.ExtrudeGeometry(shape, { depth: uld.depth * s, bevelEnabled: false })
      sc.add(new THREE.LineSegments(new THREE.EdgesGeometry(shell), new THREE.LineBasicMaterial({ color: 0x1d4ed8 })))
      const glass = new THREE.Mesh(shell, new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.06, depthWrite: false }))
      sc.add(glass)
      // The floor / pallet base.
      const base = new THREE.Mesh(new THREE.BoxGeometry(uld.width * s, 0.02, uld.depth * s), new THREE.MeshStandardMaterial({ color: 0x64748b }))
      base.position.set((uld.width / 2) * s, -0.01, (uld.depth / 2) * s)
      sc.add(base)

      // Boxes: one mesh per box, edges drawn so neighbours read apart.
      const colours = [0x2f7d4f, 0x8bc34a]
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const edges = new THREE.EdgesGeometry(geo)
      const mats = colours.map((c) => new THREE.MeshStandardMaterial({ color: c }))
      const line = new THREE.LineBasicMaterial({ color: 0x0f2a1a })
      const byLayer: InstanceType<typeof THREE.Group>[] = []
      for (const b of plan.boxes) {
        const g = (byLayer[b.layer] ??= new THREE.Group())
        const m = new THREE.Mesh(geo, mats[b.layer % 2])
        const e = new THREE.LineSegments(edges, line)
        for (const o of [m, e]) {
          o.scale.set(b.dx * s * 0.995, b.dz * s * 0.995, b.dy * s * 0.995)
          o.position.set((b.x + b.dx / 2) * s, (b.z + b.dz / 2) * s, (b.y + b.dy / 2) * s)
          g.add(o)
        }
      }
      for (const g of byLayer) if (g) sc.add(g)
      const setLayers = (n: number) => byLayer.forEach((g, i) => g && (g.visible = i < n))
      setLayers(upTo)

      let frame = 0
      const tick = () => {
        controls.update()
        renderer.render(sc, camera)
        frame = requestAnimationFrame(tick)
      }
      tick()
      const resize = new ResizeObserver(() => {
        camera.aspect = el.clientWidth / el.clientHeight
        camera.updateProjectionMatrix()
        renderer.setSize(el.clientWidth, el.clientHeight)
      })
      resize.observe(el)
      scene.current = {
        setLayers,
        dispose: () => {
          cancelAnimationFrame(frame)
          resize.disconnect()
          controls.dispose()
          renderer.dispose()
          geo.dispose()
          edges.dispose()
          shell.dispose()
          renderer.domElement.remove()
        },
      }
    })()
    return () => {
      cancelled = true
      scene.current?.dispose()
      scene.current = null
    }
    // Rebuilt when the container or plan changes; the layer slider only shows or hides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uld, plan])

  React.useEffect(() => scene.current?.setLayers(upTo), [upTo])

  return <div ref={host} className={className} />
}
