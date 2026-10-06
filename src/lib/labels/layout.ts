import { z } from 'zod'
import { LABEL_FIELDS, fieldDef, type FieldKey } from './fields'
import { FOUR_INCH_PRINT_WIDTH_MM } from './units'

export type CaptionLang = 'en' | 'nl' | 'none'
export type Align = 'left' | 'center' | 'right'
export type Orientation = 'normal' | 'rotated'
export type LogoVariant = 'full' | 'mark'

interface Box {
  id: string
  /** Position and size in mm, from the label's top-left corner as you read it. */
  x: number
  y: number
  w: number
  h: number
}
interface TextStyle {
  fontPt: number
  bold: boolean
  align: Align
}

export type FieldElement = Box & TextStyle & { type: 'field'; field: FieldKey; caption: CaptionLang }
export type TextElement = Box & TextStyle & { type: 'text'; text: string }
export type BoxIdElement = Box & TextStyle & { type: 'box_id'; caption: CaptionLang }
export type BoxCountElement = Box & TextStyle & { type: 'box_count'; caption: 'en' | 'nl'; style: 'words' | 'numbers' }
export type QrElement = Box & { type: 'qr' }
export type LogoElement = Box & { type: 'logo'; variant: LogoVariant }
/** Where the "REPRINT" mark goes. Printed on reprints only. */
export type ReprintElement = Box & { type: 'reprint' }

export type LabelElement =
  | FieldElement
  | TextElement
  | BoxIdElement
  | BoxCountElement
  | QrElement
  | LogoElement
  | ReprintElement
export type ElementType = LabelElement['type']
export type TextLikeElement = FieldElement | TextElement | BoxIdElement | BoxCountElement

export interface LabelLayout {
  version: 1
  elements: LabelElement[]
}

/** One saved version of a template: size, feed direction and layout. */
export interface LabelDesign {
  widthMm: number
  heightMm: number
  orientation: Orientation
  layout: LabelLayout
}

/** Always on the label. They can be moved and resized, never removed. */
export const REQUIRED_TYPES = ['qr', 'box_id', 'box_count'] as const
/** Can't be removed in the designer (the reprint mark position as well as the required ones). */
export const LOCKED_TYPES: readonly ElementType[] = [...REQUIRED_TYPES, 'reprint']

export const isLocked = (el: LabelElement) => LOCKED_TYPES.includes(el.type)
export const isTextLike = (el: LabelElement): el is TextLikeElement =>
  el.type === 'field' || el.type === 'text' || el.type === 'box_id' || el.type === 'box_count'

/** Width / height of the logo artwork in public/labels. */
export const LOGO_ASPECT: Record<LogoVariant, number> = { full: 1200 / 463, mark: 219 / 303 }

export const SIZE_PRESETS = [
  { id: '150x70', label: '150 × 70 mm', w: 150, h: 70 },
  { id: '100x150', label: '100 × 150 mm', w: 100, h: 150 },
  { id: '100x100', label: '100 × 100 mm', w: 100, h: 100 },
] as const
export const DEFAULT_SIZE = SIZE_PRESETS[0]
export const MIN_SIZE_MM = 20
export const MAX_SIZE_MM = 300

/** A 4-inch printer can't take a label wider than its print head, so wide labels are fed sideways. */
export function defaultOrientation(widthMm: number, heightMm: number): Orientation {
  return widthMm > FOUR_INCH_PRINT_WIDTH_MM && heightMm <= FOUR_INCH_PRINT_WIDTH_MM ? 'rotated' : 'normal'
}

// ---------------------------------------------------------------------------
// Validation (also applied to layouts read back from the database)
// ---------------------------------------------------------------------------

const box = {
  id: z.string().min(1).max(40),
  x: z.number().min(0).max(MAX_SIZE_MM),
  y: z.number().min(0).max(MAX_SIZE_MM),
  w: z.number().min(1).max(MAX_SIZE_MM),
  h: z.number().min(1).max(MAX_SIZE_MM),
}
const textStyle = {
  fontPt: z.number().min(4).max(96),
  bold: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
}
const caption = z.enum(['en', 'nl', 'none'])

const elementSchema = z.discriminatedUnion('type', [
  z.object({ ...box, ...textStyle, type: z.literal('field'), field: z.string().refine((k) => !!fieldDef(k), 'Unknown field'), caption }),
  z.object({ ...box, ...textStyle, type: z.literal('text'), text: z.string().max(200) }),
  z.object({ ...box, ...textStyle, type: z.literal('box_id'), caption }),
  z.object({ ...box, ...textStyle, type: z.literal('box_count'), caption: z.enum(['en', 'nl']), style: z.enum(['words', 'numbers']) }),
  z.object({ ...box, type: z.literal('qr') }),
  z.object({ ...box, type: z.literal('logo'), variant: z.enum(['full', 'mark']) }),
  z.object({ ...box, type: z.literal('reprint') }),
])

export const layoutSchema = z
  .object({ version: z.literal(1), elements: z.array(elementSchema).max(60) })
  .superRefine((layout, ctx) => {
    const count = (t: ElementType) => layout.elements.filter((e) => e.type === t).length
    for (const t of REQUIRED_TYPES) {
      if (count(t) !== 1) ctx.addIssue({ code: 'custom', message: `The label must have exactly one ${t} element.` })
    }
    for (const t of ['logo', 'reprint'] as const) {
      if (count(t) > 1) ctx.addIssue({ code: 'custom', message: `The label can have only one ${t} element.` })
    }
    const ids = layout.elements.map((e) => e.id)
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Element ids must be unique.' })
  })

export function parseLayout(json: unknown): LabelLayout {
  return layoutSchema.parse(json) as LabelLayout
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

const round = (n: number) => Math.round(n * 10) / 10

/** Keeps an element inside the label, shrinking it if the label got smaller. QR codes stay square. */
export function clampElement<T extends LabelElement>(el: T, widthMm: number, heightMm: number): T {
  let w = Math.min(Math.max(el.w, 1), widthMm)
  let h = Math.min(Math.max(el.h, 1), heightMm)
  if (el.type === 'qr') w = h = Math.min(w, h)
  const x = Math.min(Math.max(el.x, 0), widthMm - w)
  const y = Math.min(Math.max(el.y, 0), heightMm - h)
  return { ...el, x: round(x), y: round(y), w: round(w), h: round(h) }
}

export function fitLayoutToLabel(layout: LabelLayout, widthMm: number, heightMm: number): LabelLayout {
  return { ...layout, elements: layout.elements.map((e) => clampElement(e, widthMm, heightMm)) }
}

export function newElementId(type: ElementType) {
  return `${type}-${Math.random().toString(36).slice(2, 8)}`
}

export function elementName(el: LabelElement): string {
  switch (el.type) {
    case 'field':
      return fieldDef(el.field)?.en ?? el.field
    case 'text':
      return el.text ? `Text "${el.text.length > 24 ? `${el.text.slice(0, 24)}…` : el.text}"` : 'Text'
    case 'box_id':
      return 'Box ID'
    case 'box_count':
      return 'Box n of N'
    case 'qr':
      return 'QR code'
    case 'logo':
      return el.variant === 'full' ? 'ConsolFlora logo' : 'ConsolFlora logo mark'
    case 'reprint':
      return 'REPRINT mark'
  }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// ---------------------------------------------------------------------------
// Default layouts for the size presets
// ---------------------------------------------------------------------------

function f(field: FieldKey, x: number, y: number, w: number, h: number, fontPt: number, opts: Partial<FieldElement> = {}): FieldElement {
  return { id: `f-${field}`, type: 'field', field, x, y, w, h, fontPt, bold: false, align: 'left', caption: 'en', ...opts }
}
type XYW = [x: number, y: number, w: number]
type XYWH = [x: number, y: number, w: number, h: number]
type XYWHPt = [x: number, y: number, w: number, h: number, fontPt?: number]

function fixed(x: { logo: XYW; qr: XYW; boxId: XYWHPt; boxCount: XYWHPt; reprint: XYWH }): LabelElement[] {
  const [lx, ly, lw] = x.logo
  const [qx, qy, qs] = x.qr
  const [ix, iy, iw, ih, ipt = 9] = x.boxId
  const [cx, cy, cw, ch, cpt = 16] = x.boxCount
  const [rx, ry, rw, rh] = x.reprint
  return [
    { id: 'logo', type: 'logo', variant: 'full', x: lx, y: ly, w: lw, h: round(lw / LOGO_ASPECT.full) },
    { id: 'qr', type: 'qr', x: qx, y: qy, w: qs, h: qs },
    { id: 'box_id', type: 'box_id', x: ix, y: iy, w: iw, h: ih, fontPt: ipt, bold: false, align: 'center', caption: 'en' },
    { id: 'box_count', type: 'box_count', x: cx, y: cy, w: cw, h: ch, fontPt: cpt, bold: true, align: 'center', caption: 'en', style: 'words' },
    { id: 'reprint', type: 'reprint', x: rx, y: ry, w: rw, h: rh },
  ]
}

const PRESET_LAYOUTS: Record<(typeof SIZE_PRESETS)[number]['id'], LabelElement[]> = {
  '150x70': [
    ...fixed({ logo: [4, 4, 42], qr: [108, 4, 38], boxId: [104, 43, 42, 5], boxCount: [104, 49, 42, 8, 16], reprint: [111, 60, 28, 6] }),
    f('customer_name', 4, 22, 98, 7, 14, { bold: true, caption: 'none' }),
    f('destination_airport', 4, 30, 60, 6, 12, { bold: true }),
    f('variety', 4, 37, 98, 8, 16, { bold: true, caption: 'none' }),
    f('grade', 4, 46, 30, 5.5, 11),
    f('stem_length', 36, 46, 40, 5.5, 11),
    f('stems_per_bunch', 4, 52.5, 48, 5, 10),
    f('bunches_per_box', 54, 52.5, 48, 5, 10),
    f('farm_name', 4, 58.5, 98, 5, 10),
    f('shipment_ref', 4, 64, 98, 4.5, 9),
  ],
  '100x150': [
    ...fixed({ logo: [5, 5, 50], qr: [58, 5, 37], boxId: [55, 43, 42, 5], boxCount: [5, 50, 90, 12, 28], reprint: [60, 137, 35, 8] }),
    f('customer_name', 5, 27, 50, 7, 14, { bold: true, caption: 'none' }),
    f('destination_airport', 5, 35, 50, 6, 12, { bold: true }),
    f('variety', 5, 65, 90, 10, 20, { bold: true, caption: 'none' }),
    f('flower_type', 5, 77, 45, 6, 12),
    f('colour', 50, 77, 45, 6, 12),
    f('grade', 5, 84, 45, 6, 12),
    f('stem_length', 50, 84, 45, 6, 12),
    f('stems_per_bunch', 5, 91, 45, 6, 11),
    f('bunches_per_box', 50, 91, 45, 6, 11),
    f('farm_name', 5, 100, 90, 6, 12),
    f('farm_box_count', 5, 107, 45, 6, 12),
    f('shipment_ref', 5, 114, 90, 6, 12),
    f('mawb', 5, 121, 90, 6, 12),
    f('pack_date', 5, 128, 50, 6, 11),
  ],
  '100x100': [
    ...fixed({ logo: [4, 4, 44], qr: [60, 4, 36], boxId: [56, 41, 42, 4.5, 8], boxCount: [4, 47, 92, 10, 24], reprint: [70, 89, 26, 7] }),
    f('customer_name', 4, 23, 52, 6.5, 13, { bold: true, caption: 'none' }),
    f('destination_airport', 4, 31, 52, 6, 11, { bold: true }),
    f('variety', 4, 59, 92, 8, 16, { bold: true, caption: 'none' }),
    f('grade', 4, 68.5, 44, 5.5, 11),
    f('stem_length', 50, 68.5, 46, 5.5, 11),
    f('stems_per_bunch', 4, 75, 44, 5.5, 10),
    f('bunches_per_box', 50, 75, 46, 5.5, 10),
    f('farm_name', 4, 81.5, 92, 5.5, 11),
    f('shipment_ref', 4, 88, 64, 5.5, 10),
  ],
}

/** Layout for a new template. Custom sizes start from the preset with the closest shape, scaled to fit. */
export function defaultLayout(widthMm: number, heightMm: number): LabelLayout {
  const exact = SIZE_PRESETS.find((p) => p.w === widthMm && p.h === heightMm)
  const preset =
    exact ??
    [...SIZE_PRESETS].sort((a, b) => Math.abs(a.w / a.h - widthMm / heightMm) - Math.abs(b.w / b.h - widthMm / heightMm))[0]!
  const sx = widthMm / preset.w
  const sy = heightMm / preset.h
  const s = Math.min(sx, sy)
  const elements = PRESET_LAYOUTS[preset.id].map((el) => {
    const scaled = { ...el, x: el.x * sx, y: el.y * sy, w: el.w * sx, h: el.h * sy }
    if (el.type === 'qr') scaled.w = scaled.h = el.w * s
    if (el.type === 'logo') scaled.h = scaled.w / LOGO_ASPECT[el.variant]
    if (isTextLike(scaled)) scaled.fontPt = Math.max(5, Math.round((scaled as TextLikeElement).fontPt * s))
    return clampElement(scaled as LabelElement, widthMm, heightMm)
  })
  return { version: 1, elements }
}

/**
 * The first free spot for a box of this size, scanning from the top-left in 1 mm rows and
 * 2 mm steps. Falls back to the top-left corner when the label is full.
 */
export function freeSpot(elements: LabelElement[], w: number, h: number, widthMm: number, heightMm: number) {
  const margin = 2
  for (let y = margin; y + h <= heightMm - margin + 1e-9; y += 1) {
    for (let x = margin; x + w <= widthMm - margin + 1e-9; x += 2) {
      if (!elements.some((e) => overlaps({ x, y, w, h }, e))) return { x, y }
    }
  }
  return { x: margin, y: margin }
}

/** A new element of each kind, at a default size, in the first free spot on the label. */
export function newElement(
  type: 'field' | 'text' | 'logo',
  widthMm: number,
  heightMm: number,
  field?: FieldKey,
  existing: LabelElement[] = [],
): LabelElement {
  const id = newElementId(type)
  const w = type === 'logo' ? Math.min(40, widthMm - 8) : Math.min(type === 'text' ? 50 : 45, widthMm - 8)
  const h = type === 'logo' ? round(w / LOGO_ASPECT.full) : 6
  const at = freeSpot(existing, w, h, widthMm, heightMm)
  const text = { ...at, w, h, align: 'left' as const, bold: false, fontPt: 11 }
  const el: LabelElement =
    type === 'logo'
      ? { id, type: 'logo', variant: 'full', ...at, w, h }
      : type === 'text'
        ? { id, type: 'text', text: 'Text', ...text }
        : { id, type: 'field', field: field ?? LABEL_FIELDS[0].key, caption: 'en', ...text }
  return clampElement(el, widthMm, heightMm)
}
