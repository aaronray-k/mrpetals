import * as React from 'react'
import {
  LOGO_ASPECT,
  clampElement,
  fitLayoutToLabel,
  isLocked,
  isTextLike,
  type CaptionLang,
  type LabelDesign,
  type LabelElement,
  type Orientation,
} from '~/lib/labels/layout'

export interface TemplateMeta {
  name: string
  customerId: string | null
  isDefault: boolean
}

interface Snapshot {
  design: LabelDesign
  meta: TemplateMeta
}

export interface DesignerState extends Snapshot {
  selectedId: string | null
  past: Snapshot[]
  future: Snapshot[]
  /** Edit session of the last recorded change. Later changes in the same session share its undo step. */
  lastGroup?: string | null
}

export type DesignerAction =
  | { type: 'load'; design: LabelDesign; meta?: TemplateMeta; keepHistory?: boolean }
  | { type: 'select'; id: string | null }
  /** Records the current state for undo, before a drag or a typing session. */
  | { type: 'checkpoint' }
  | { type: 'update'; id: string; patch: Partial<LabelElement>; record?: boolean; group?: string }
  | { type: 'add'; element: LabelElement }
  | { type: 'remove'; id: string }
  | { type: 'size'; widthMm: number; heightMm: number; record?: boolean; group?: string }
  | { type: 'orientation'; orientation: Orientation; record?: boolean; group?: string }
  | { type: 'meta'; patch: Partial<TemplateMeta>; record?: boolean; group?: string }
  | { type: 'captions'; lang: Exclude<CaptionLang, 'none'> }
  | { type: 'undo' }
  | { type: 'redo' }

const HISTORY_LIMIT = 100

const snap = (s: DesignerState): Snapshot => ({ design: s.design, meta: s.meta })
const record = (s: DesignerState): Pick<DesignerState, 'past' | 'future' | 'lastGroup'> => ({
  past: [...s.past.slice(-HISTORY_LIMIT + 1), snap(s)],
  future: [],
  lastGroup: null,
})

/**
 * Undo bookkeeping for a change. `record: false` never records (used mid-drag, after a checkpoint).
 * A `group` (one per focus of an input) records only its first change, so typing "120" is one step.
 */
function history(s: DesignerState, a: { record?: boolean; group?: string }): Partial<DesignerState> {
  if (a.record === false) return {}
  if (a.group !== undefined && a.group === s.lastGroup) return {}
  return { ...record(s), lastGroup: a.group ?? null }
}

/** Applies a size or position change, keeping QR codes square and logos in proportion. */
function applyPatch(el: LabelElement, patch: Partial<LabelElement>, design: LabelDesign): LabelElement {
  const next = { ...el, ...patch } as LabelElement
  if (next.type === 'qr' && (patch.w !== undefined || patch.h !== undefined)) {
    const size = patch.w ?? patch.h!
    next.w = next.h = size
  }
  if (next.type === 'logo') {
    if (patch.w !== undefined) next.h = next.w / LOGO_ASPECT[next.variant]
    else if (patch.h !== undefined || 'variant' in patch) next.w = next.h * LOGO_ASPECT[next.variant]
  }
  return clampElement(next, design.widthMm, design.heightMm)
}

function withElements(s: DesignerState, elements: LabelElement[]): LabelDesign {
  return { ...s.design, layout: { ...s.design.layout, elements } }
}

export function designerReducer(s: DesignerState, a: DesignerAction): DesignerState {
  switch (a.type) {
    case 'load':
      return {
        design: a.design,
        meta: a.meta ?? s.meta,
        selectedId: null,
        ...(a.keepHistory ? record(s) : { past: [], future: [] }),
      }
    case 'select':
      return { ...s, selectedId: a.id }
    case 'checkpoint':
      return { ...s, ...record(s) }
    case 'update': {
      const elements = s.design.layout.elements.map((e) => (e.id === a.id ? applyPatch(e, a.patch, s.design) : e))
      return { ...s, ...history(s, a), design: withElements(s, elements) }
    }
    case 'add':
      return {
        ...s,
        ...record(s),
        design: withElements(s, [...s.design.layout.elements, clampElement(a.element, s.design.widthMm, s.design.heightMm)]),
        selectedId: a.element.id,
      }
    case 'remove': {
      const el = s.design.layout.elements.find((e) => e.id === a.id)
      if (!el || isLocked(el)) return s
      return {
        ...s,
        ...record(s),
        design: withElements(s, s.design.layout.elements.filter((e) => e.id !== a.id)),
        selectedId: s.selectedId === a.id ? null : s.selectedId,
      }
    }
    case 'size': {
      const design = { ...s.design, widthMm: a.widthMm, heightMm: a.heightMm }
      return {
        ...s,
        ...history(s, a),
        design: { ...design, layout: fitLayoutToLabel(s.design.layout, a.widthMm, a.heightMm) },
      }
    }
    case 'orientation':
      return { ...s, ...history(s, a), design: { ...s.design, orientation: a.orientation } }
    case 'meta':
      return { ...s, ...history(s, a), meta: { ...s.meta, ...a.patch } }
    case 'captions': {
      const elements = s.design.layout.elements.map((e) => {
        if (!isTextLike(e) || e.type === 'text') return e
        if (e.type === 'box_count') return { ...e, caption: a.lang }
        return e.caption === 'none' ? e : { ...e, caption: a.lang }
      })
      return { ...s, ...record(s), design: withElements(s, elements) }
    }
    case 'undo': {
      const prev = s.past[s.past.length - 1]
      if (!prev) return s
      return { ...s, ...prev, past: s.past.slice(0, -1), future: [snap(s), ...s.future], lastGroup: null }
    }
    case 'redo': {
      const next = s.future[0]
      if (!next) return s
      return { ...s, ...next, past: [...s.past, snap(s)], future: s.future.slice(1), lastGroup: null }
    }
  }
}

/** A fresh edit-session id each time an input gets focus. Pass it as `group` with each change. */
export function useEditSession(name: string) {
  const id = React.useRef(`${name}:0`)
  const count = React.useRef(0)
  return {
    onFocus: () => {
      id.current = `${name}:${++count.current}`
    },
    group: () => id.current,
  }
}

export function useDesigner(initial: Snapshot) {
  const [state, dispatch] = React.useReducer(designerReducer, { ...initial, selectedId: null, past: [], future: [] })
  const selected = state.design.layout.elements.find((e) => e.id === state.selectedId) ?? null
  return { state, dispatch, selected }
}

