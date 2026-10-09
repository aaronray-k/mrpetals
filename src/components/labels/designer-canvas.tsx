import * as React from 'react'
import { SAMPLE_LABEL_DATA } from '~/lib/labels/data'
import { renderLabel } from '~/lib/labels/engine'
import { elementName, isLocked, type LabelElement } from '~/lib/labels/layout'
import { LabelSvg } from './label-svg'
import type { DesignerAction, DesignerState } from './use-designer'

const snap = (mm: number, fine: boolean) => (fine ? Math.round(mm * 10) / 10 : Math.round(mm * 2) / 2)

interface Drag {
  id: string
  mode: 'move' | 'resize'
  start: { x: number; y: number }
  orig: { x: number; y: number; w: number; h: number }
  moved: boolean
}

export function DesignerCanvas({
  state,
  dispatch,
  showReprint,
  flaggedIds,
  onLockedDelete,
}: {
  state: DesignerState
  dispatch: React.Dispatch<DesignerAction>
  showReprint: boolean
  /** Elements named in a warning get an amber outline. */
  flaggedIds: Set<string>
  onLockedDelete: (el: LabelElement) => void
}) {
  const svgRef = React.useRef<SVGSVGElement>(null)
  const drag = React.useRef<Drag | null>(null)
  const { design } = state
  const label = React.useMemo(() => renderLabel(design, SAMPLE_LABEL_DATA, { reprint: showReprint }), [design, showReprint])

  const toMm = (e: React.PointerEvent) => {
    const svg = svgRef.current!
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const startDrag = (el: LabelElement, mode: Drag['mode']) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    svgRef.current?.setPointerCapture(e.pointerId)
    dispatch({ type: 'select', id: el.id })
    drag.current = { id: el.id, mode, start: toMm(e), orig: { x: el.x, y: el.y, w: el.w, h: el.h }, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toMm(e)
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    if (!d.moved) {
      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return
      d.moved = true
      dispatch({ type: 'checkpoint' }) // one undo step per drag
    }
    const fine = e.altKey
    const patch =
      d.mode === 'move'
        ? { x: snap(d.orig.x + dx, fine), y: snap(d.orig.y + dy, fine) }
        : { w: Math.max(2, snap(d.orig.w + dx, fine)), h: Math.max(2, snap(d.orig.h + dy, fine)) }
    dispatch({ type: 'update', id: d.id, patch, record: false })
  }

  const endDrag = (e: React.PointerEvent) => {
    if (drag.current) svgRef.current?.releasePointerCapture(e.pointerId)
    drag.current = null
  }

  const onKeyDown = (el: LabelElement) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : e.altKey ? 0.5 : 1
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = moves[e.key]
    if (move) {
      e.preventDefault()
      dispatch({ type: 'update', id: el.id, patch: { x: el.x + move[0], y: el.y + move[1] } })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      if (isLocked(el)) onLockedDelete(el)
      else dispatch({ type: 'remove', id: el.id })
    } else if (e.key === 'Escape') {
      dispatch({ type: 'select', id: null })
    }
  }

  // Keep the label inside the viewport: as wide as the column, never taller than ~60% of the screen.
  const maxWidth = `min(100%, calc(60vh * ${design.widthMm} / ${design.heightMm}))`

  return (
    <div className="rounded-lg border bg-muted/60 p-4 sm:p-6">
      <div className="mx-auto" style={{ width: maxWidth }}>
        <LabelSvg
          svgRef={svgRef}
          label={label}
          title={`Label canvas, ${design.widthMm} by ${design.heightMm} millimetres, showing a sample box`}
          // A group, not an image: it contains the focusable elements.
          role="group"
          className="block h-auto w-full touch-none rounded-sm shadow-lg ring-1 ring-black/10 select-none"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={() => dispatch({ type: 'select', id: null })}
        >
          {design.layout.elements.map((el) => {
            const selected = el.id === state.selectedId
            const flagged = flaggedIds.has(el.id)
            const locked = isLocked(el)
            return (
              <g
                key={el.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${elementName(el)}${locked ? ', always on the label' : ''}. ${el.x} mm from the left, ${el.y} mm from the top, ${el.w} by ${el.h} mm. Arrow keys move it${locked ? '' : ', Delete removes it'}.`}
                onFocus={() => dispatch({ type: 'select', id: el.id })}
                onKeyDown={onKeyDown(el)}
                onPointerDown={startDrag(el, 'move')}
                className="cursor-move outline-none"
              >
                {el.type === 'reprint' && !showReprint && (
                  <>
                    <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="#f4f4f4" stroke="#9a9a9a" strokeDasharray="1 0.6" strokeWidth={0.25} />
                    <text x={el.x + el.w / 2} y={el.y + el.h / 2 + Math.min(3, el.h * 0.5) * 0.35} fontSize={Math.min(3, el.h * 0.5)} textAnchor="middle" fill="#777" fontFamily="Helvetica, Arial, sans-serif">
                      REPRINT
                    </text>
                    <title>REPRINT mark: printed on reprints only</title>
                  </>
                )}
                <rect
                  x={el.x}
                  y={el.y}
                  width={el.w}
                  height={el.h}
                  fill="transparent"
                  stroke={selected ? 'var(--accent)' : flagged ? '#d48806' : 'rgba(0,0,0,0.18)'}
                  strokeWidth={selected ? 2 : flagged ? 2 : 1}
                  strokeDasharray={selected ? undefined : '4 3'}
                  vectorEffect="non-scaling-stroke"
                />
                {selected && (
                  <rect
                    x={el.x + el.w - 1.6}
                    y={el.y + el.h - 1.6}
                    width={3.2}
                    height={3.2}
                    fill="var(--accent)"
                    stroke="#fff"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-nwse-resize"
                    onPointerDown={startDrag(el, 'resize')}
                  >
                    <title>Drag to resize</title>
                  </rect>
                )}
              </g>
            )
          })}
        </LabelSvg>
      </div>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        {design.widthMm} × {design.heightMm} mm · sample box ·{' '}
        {design.orientation === 'rotated' ? 'fed sideways through the printer (left edge first)' : 'fed top edge first'}
      </p>
    </div>
  )
}
