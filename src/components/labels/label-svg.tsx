import * as React from 'react'
import { TEXT_ASCENT, type DrawOp, type RenderedLabel } from '~/lib/labels/engine'
import { LOGO_URLS } from '~/lib/labels/logo-assets'

/** QR modules as one path of horizontal runs (no hairline gaps, small DOM). */
function qrPath(op: Extract<DrawOp, { kind: 'qr' }>) {
  const m = op.size / op.modules.length
  let d = ''
  op.modules.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (!row[c]) continue
      let end = c
      while (end + 1 < row.length && row[end + 1]) end++
      d += `M${op.x + c * m} ${op.y + r * m}h${(end - c + 1) * m}v${m}h${-(end - c + 1) * m}z`
      c = end
    }
  })
  return d
}

const ANCHOR = { left: 'start', center: 'middle', right: 'end' } as const

export function LabelOps({ ops }: { ops: DrawOp[] }) {
  return (
    <>
      {ops.map((op, i) => {
        switch (op.kind) {
          case 'logo':
            return <image key={i} href={LOGO_URLS[op.variant]} x={op.x} y={op.y} width={op.w} height={op.h} preserveAspectRatio="none" />
          case 'fill':
            return <rect key={i} x={op.x} y={op.y} width={op.w} height={op.h} fill="#000" />
          case 'qr':
            return <path key={i} d={qrPath(op)} fill="#000" shapeRendering="crispEdges" />
          case 'text': {
            const x = op.align === 'left' ? op.x : op.align === 'center' ? op.x + op.w / 2 : op.x + op.w
            return (
              <text
                key={i}
                x={x}
                y={op.top + op.size * TEXT_ASCENT}
                fontSize={op.size}
                fontWeight={op.bold ? 700 : 400}
                fontFamily="Helvetica, Arial, sans-serif"
                textAnchor={ANCHOR[op.align]}
                fill={op.color === 'white' ? '#fff' : '#000'}
                style={{ whiteSpace: 'pre' }}
              >
                {op.text}
              </text>
            )
          }
        }
      })}
    </>
  )
}

/** A label drawn to scale. Units inside are millimetres. */
export function LabelSvg({
  label,
  title,
  className,
  children,
  svgRef,
  ...rest
}: {
  label: RenderedLabel
  title: string
  className?: string
  children?: React.ReactNode
  svgRef?: React.Ref<SVGSVGElement>
} & Omit<React.SVGProps<SVGSVGElement>, 'ref'>) {
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${label.widthMm} ${label.heightMm}`}
      className={className}
      role="img"
      aria-label={title}
      {...rest}
    >
      <rect x={0} y={0} width={label.widthMm} height={label.heightMm} fill="#fff" />
      <LabelOps ops={label.ops} />
      {children}
    </svg>
  )
}
