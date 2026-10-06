import type { Cell, ParsedRow, ParsedWorkbook } from './parse'
import { MAX_ROWS_PER_SHEET } from './parse'
import { CODE_SHEET, SHEETS, type CodeKind, type ColumnDef, type ListName, type SheetName } from './schema'

export interface Issue {
  level: 'error' | 'warning'
  /** Spreadsheet row number, or null for a problem with the whole sheet. */
  row: number | null
  column: string | null
  message: string
}

/** What the database already holds, as far as the dry run needs to know. */
export interface DbSnapshot {
  codes: Record<CodeKind, string[]>
  lists: Partial<Record<ListName, string[]>>
  /** Keys of the chosen sheet already in the database, joined with '|'. Decides insert vs update. */
  existingKeys: string[]
  /** 'product_code|box_code' pairs that have a pack rate. */
  packRates: string[]
  closedShipments: string[]
  shipmentLineCounts: Record<string, number>
}

export type DbValue = string | number | boolean | null
export type DbRow = Record<string, DbValue>

export interface DryRunResult {
  sheet: SheetName
  ok: boolean
  issues: Issue[]
  rows: DbRow[]
  counts: { total: number; inserts: number; updates: number }
}

export const MAX_ISSUES = 1000

// ---------------------------------------------------------------------------
// Single-value checks. Each returns the cleaned value, or an error message.
// ---------------------------------------------------------------------------

type Check = { ok: true; value: DbValue } | { ok: false; message: string }
const ok = (value: DbValue): Check => ({ ok: true, value })
const fail = (message: string): Check => ({ ok: false, message })

const show = (v: Cell) => (typeof v === 'string' ? `'${v}'` : String(v))

function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, ''))) return Number(v.replace(/,/g, ''))
  return null
}

export function glnIsValid(gln: string) {
  if (!/^\d{13}$/.test(gln)) return false
  const digits = [...gln].map(Number)
  const sum = digits.slice(0, 12).reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10 === digits[12]
}

/** IATA air waybill: the 8th digit of the serial is the first seven modulo 7. */
export function awbCheckDigit(serial8: string) {
  return Number(serial8.slice(0, 7)) % 7
}

function excelSerialToIso(serial: number) {
  // Excel day 25569 is 1970-01-01.
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10)
}

function isRealDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

function describeMin(col: ColumnDef) {
  if (col.type === 'int') return `a whole number of ${col.min ?? 0} or more`
  if (col.min !== undefined && col.min > 0) return 'a number greater than 0'
  return `a number of ${col.min ?? 0} or more`
}

export function checkValue(col: ColumnDef, raw: Cell): Check {
  const k = col.key
  switch (col.type) {
    case 'text': {
      const s = String(raw)
      const max = col.maxLength ?? 500
      return s.length > max ? fail(`${k} is too long (${s.length} characters, at most ${max}).`) : ok(s)
    }
    case 'code': {
      const s = String(raw)
      if (/\s/.test(s)) return fail(`${k} must not contain spaces (found ${show(raw)}).`)
      return s.length > 40 ? fail(`${k} is too long (at most 40 characters).`) : ok(s)
    }
    case 'email': {
      const s = String(raw)
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? ok(s.toLowerCase()) : fail(`${k} is not a valid email address (found ${show(raw)}).`)
    }
    case 'phone': {
      const s = String(raw)
      return /^\+?[0-9 ()-]{6,20}$/.test(s) ? ok(s) : fail(`${k} should be a phone number like +254700000000 (found ${show(raw)}).`)
    }
    case 'int':
    case 'decimal': {
      const n = toNumber(raw)
      if (n === null || (col.type === 'int' && !Number.isInteger(n)) || (col.min !== undefined && n < col.min)) {
        return fail(`${k} must be ${describeMin(col)} (found ${show(raw)}).`)
      }
      return ok(n)
    }
    case 'date': {
      let iso: string | null = null
      if (typeof raw === 'number' && raw > 0) iso = excelSerialToIso(raw)
      else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && isRealDate(raw)) iso = raw
      if (!iso) return fail(`${k} must be a date written as YYYY-MM-DD (found ${show(raw)}).`)
      if (iso <= '2020-01-01') return fail(`${k} must be after 2020-01-01 (found ${iso}).`)
      return ok(iso)
    }
    case 'gln': {
      const s = String(raw)
      return glnIsValid(s) ? ok(s) : fail(`${k} must be 13 digits with a valid check digit (found ${show(raw)}).`)
    }
    case 'iata': {
      const s = String(raw).toUpperCase()
      return /^[A-Z]{3}$/.test(s) ? ok(s) : fail(`${k} must be a 3-letter airport code such as NBO (found ${show(raw)}).`)
    }
    case 'awb': {
      const m = /^(\d{3})-?(\d{8})$/.exec(String(raw).replace(/\s/g, ''))
      if (!m) return fail(`${k} must look like 706-12345678: a 3-digit airline prefix and 8 digits (found ${show(raw)}).`)
      const [, prefix, serial] = m as unknown as [string, string, string]
      const expected = awbCheckDigit(serial)
      if (Number(serial[7]) !== expected) {
        return fail(`${k} ${prefix}-${serial} has a wrong check digit: the last digit should be ${expected}.`)
      }
      return ok(`${prefix}-${serial}`)
    }
    case 'yesno': {
      const s = String(raw).toUpperCase()
      return s === 'Y' || s === 'N' ? ok(s === 'Y') : fail(`${k} must be Y or N (found ${show(raw)}).`)
    }
  }
}

// ---------------------------------------------------------------------------
// Sheet validation
// ---------------------------------------------------------------------------

/** Values that exist in the uploaded file but maybe not yet in the database. */
function fileIndex(wb: ParsedWorkbook) {
  const sheet = (name: SheetName) => wb.sheets.find((s) => s.name === name)
  const values = (name: SheetName, key: string) =>
    new Set((sheet(name)?.rows ?? []).map((r) => r.values[key]).filter((v) => v != null).map(String))
  const codes = Object.fromEntries(
    (Object.keys(CODE_SHEET) as CodeKind[]).map((kind) => [kind, values(CODE_SHEET[kind], kind)]),
  ) as Record<CodeKind, Set<string>>
  const lists = new Map<string, Set<string>>()
  for (const r of sheet('Lists')?.rows ?? []) {
    const name = String(r.values.list_name)
    if (!lists.has(name)) lists.set(name, new Set())
    lists.get(name)!.add(String(r.values.value))
  }
  const packRates = new Set((sheet('PackRates')?.rows ?? []).map((r) => `${r.values.product_code}|${r.values.box_code}`))
  return { codes, lists, packRates }
}

function isExampleRow(example: Record<string, string | number> | undefined, values: Record<string, Cell>) {
  if (!example) return false
  return Object.entries(example).every(([k, v]) => values[k] != null && String(values[k]) === String(v))
}

export function validateSheet(wb: ParsedWorkbook, sheetName: SheetName, db: DbSnapshot): DryRunResult {
  const def = SHEETS[sheetName]
  const issues: Issue[] = []
  const rows: DbRow[] = []
  const sheetError = (message: string, column: string | null = null) => issues.push({ level: 'error', row: null, column, message })
  const result = (): DryRunResult => {
    const errors = issues.filter((i) => i.level === 'error')
    const existing = new Set(db.existingKeys)
    const updates = rows.filter((r) => existing.has(def.key.map((k) => String(r[k] ?? '')).join('|'))).length
    return {
      sheet: sheetName,
      ok: errors.length === 0 && rows.length > 0,
      issues: issues.slice(0, MAX_ISSUES),
      rows,
      counts: { total: rows.length, inserts: rows.length - updates, updates },
    }
  }

  const sheet = wb.sheets.find((s) => s.name === sheetName)
  if (!sheet) {
    sheetError(`This file has no ${sheetName} sheet. Use the ConsolFlora import template and keep the sheet names as they are.`)
    return result()
  }

  // Header checks (Lists is laid out differently and has no columns to check).
  if (sheetName !== 'Lists') {
    const known = new Set(def.columns.map((c) => c.key))
    const seen = new Set<string>()
    for (const h of sheet.headers) {
      if (!h) continue
      if (seen.has(h)) sheetError(`Column ${h} appears twice in the header row. Remove one of them.`, h)
      seen.add(h)
      if (!known.has(h)) issues.push({ level: 'warning', row: null, column: h, message: `Column ${h} is not part of the template and will be ignored.` })
    }
    for (const col of def.columns) {
      if (col.required && !seen.has(col.key)) sheetError(`Column ${col.key} is missing from the ${sheetName} sheet. It is required.`, col.key)
    }
    if (issues.some((i) => i.level === 'error')) return result()
  }

  if (sheet.rows.length === 0) {
    sheetError(`The ${sheetName} sheet has no rows to import.`)
    return result()
  }
  if (sheet.rows.length > MAX_ROWS_PER_SHEET) {
    sheetError(`The ${sheetName} sheet has more than ${MAX_ROWS_PER_SHEET} rows. Split it into smaller files.`)
    return result()
  }

  const file = fileIndex(wb)
  const dbCodes = Object.fromEntries(Object.entries(db.codes).map(([k, v]) => [k, new Set(v)])) as Record<CodeKind, Set<string>>
  const dbLists = new Map(Object.entries(db.lists).map(([k, v]) => [k, new Set(v)]))
  const dbPackRates = new Set(db.packRates)

  const keyRows = new Map<string, number>()
  const shipmentFirstRow = new Map<string, number>()
  const shipmentLines = new Map<string, number>()
  const shipmentAwb = new Map<string, { awb: string; row: number }>()
  let lastShipment: string | null = null

  for (const pr of sheet.rows) {
    const rowErrors: Issue[] = []
    const err = (column: string | null, message: string) => rowErrors.push({ level: 'error', row: pr.row, column, message: `Row ${pr.row}: ${message}` })

    if (isExampleRow(def.example, pr.values)) {
      err(null, 'this is still the example row from the template. Overwrite it with real data or delete it.')
      issues.push(...rowErrors)
      continue
    }

    const out: DbRow = {}
    for (const col of def.columns) {
      if (col.calculated) continue
      const raw = pr.values[col.key] ?? null
      if (raw == null) {
        if (col.required) err(col.key, `${col.key} is required.`)
        out[col.key] = null
        continue
      }
      const checked = checkValue(col, raw)
      if (!checked.ok) {
        err(col.key, checked.message)
        continue
      }
      out[col.key] = checked.value
      const v = String(checked.value)

      if (col.list) {
        const inDb = dbLists.get(col.list)?.has(v)
        if (!inDb) {
          if (file.lists.get(col.list)?.has(v)) {
            err(col.key, `${col.key} ${v} is on the Lists sheet but not imported yet. Import Lists first.`)
          } else {
            const allowed = [...(dbLists.get(col.list) ?? [])]
            err(col.key, `${col.key} ${v} is not on the ${col.list} list.${allowed.length ? ` Allowed: ${allowed.join(', ')}.` : ''}`)
          }
        }
      }

      if (col.ref) {
        const target = CODE_SHEET[col.ref]
        if (!dbCodes[col.ref].has(v)) {
          if (file.codes[col.ref].has(v)) {
            err(col.key, `${col.key} ${v} is on the ${target} sheet but not imported yet. Import ${target} first.`)
          } else {
            const similar = [...dbCodes[col.ref], ...file.codes[col.ref]].find((c) => c.toLowerCase() === v.toLowerCase())
            err(col.key, `${col.key} ${v} is not on ${target}.${similar ? ` Did you mean ${similar}? Codes are case-sensitive.` : ''}`)
          }
        }
      }
    }

    if (sheetName === 'Lists' && out.list_name != null) out.sort_order = Number(pr.values.sort_order ?? 0)
    if ('valid_from' in out && out.valid_from && out.valid_to && String(out.valid_to) < String(out.valid_from)) {
      err('valid_to', `valid_to (${out.valid_to}) is before valid_from (${out.valid_from}).`)
    }

    if (sheetName === 'PackingList' && out.shipment_ref) {
      const ref = String(out.shipment_ref)
      if (ref !== lastShipment && shipmentFirstRow.has(ref)) {
        err('shipment_ref', `shipment_ref ${ref} already started on row ${shipmentFirstRow.get(ref)}. Rows of one shipment must sit together.`)
      }
      if (!shipmentFirstRow.has(ref)) {
        shipmentFirstRow.set(ref, pr.row)
        if (db.closedShipments.includes(ref)) err('shipment_ref', `shipment ${ref} is closed, so its packing list can't change.`)
      }
      lastShipment = ref
      const lineNo = (shipmentLines.get(ref) ?? 0) + 1
      shipmentLines.set(ref, lineNo)
      out.line_no = lineNo

      if (out.awb) {
        const first = shipmentAwb.get(ref)
        if (!first) shipmentAwb.set(ref, { awb: String(out.awb), row: pr.row })
        else if (first.awb !== out.awb) err('awb', `awb ${out.awb} differs from ${first.awb} on row ${first.row}. A shipment has one master air waybill.`)
      }

      const product = out.product_code
      const box = out.box_code
      const codesOk = !rowErrors.some((e) => e.column === 'product_code' || e.column === 'box_code')
      if (product && box && codesOk && !dbPackRates.has(`${product}|${box}`)) {
        err(
          'box_code',
          file.packRates.has(`${product}|${box}`)
            ? `the pack rate for ${product} in box ${box} is on the PackRates sheet but not imported yet. Import PackRates first.`
            : `there is no pack rate for ${product} in box ${box}. Add it on PackRates.`,
        )
      }
    }

    // Duplicate keys within the sheet.
    const keyVals = def.key.map((k) => out[k])
    const optionalKey = (k: string) => def.columns.some((c) => c.key === k && !c.required)
    if (keyVals.every((v, i) => v != null || optionalKey(def.key[i]!))) {
      const keyStr = keyVals.map((v) => String(v ?? '')).join('|')
      const firstRow = keyRows.get(keyStr)
      if (firstRow !== undefined) {
        const keyCols = def.key.filter((k) => k !== 'line_no')
        const label = keyCols.length === 1 ? `${keyCols[0]} ${keyVals[0]}` : `the same ${keyCols.join(' + ')} (${keyVals.filter((_, i) => def.key[i] !== 'line_no').map((v) => v ?? 'blank').join(', ')})`
        err(keyCols[0] ?? null, `${label} is also on row ${firstRow}. Each one may appear only once.`)
      } else {
        keyRows.set(keyStr, pr.row)
      }
    }

    issues.push(...rowErrors)
    if (rowErrors.length === 0) rows.push(out)
  }

  if (sheetName === 'PackingList') {
    for (const [ref, lines] of shipmentLines) {
      const existing = db.shipmentLineCounts[ref] ?? 0
      if (existing > lines) {
        issues.push({
          level: 'error',
          row: shipmentFirstRow.get(ref) ?? null,
          column: 'shipment_ref',
          message: `Shipment ${ref} already has ${existing} lines; this file has ${lines}. An import can't remove lines, so include all ${existing}.`,
        })
      }
    }
  }

  issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0))
  return result()
}

export function emptySnapshot(): DbSnapshot {
  return {
    codes: { farm_code: [], customer_code: [], product_code: [], box_code: [] },
    lists: {},
    existingKeys: [],
    packRates: [],
    closedShipments: [],
    shipmentLineCounts: {},
  }
}

export type { ParsedRow }
