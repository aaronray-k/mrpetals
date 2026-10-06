import { LIST_NAMES, SHEETS, isSheetName, normaliseHeader } from './schema'

/** A cell after parsing. Dates become 'YYYY-MM-DD' strings. */
export type Cell = string | number | boolean | null

export interface ParsedRow {
  /** Spreadsheet row number, as the user sees it in Excel. */
  row: number
  values: Record<string, Cell>
}

export interface ParsedSheet {
  name: string
  /** Normalised header per column, in order ('' for a blank header cell). */
  headers: string[]
  /** Only rows with at least one typed-in (non-calculated) value. */
  rows: ParsedRow[]
}

export interface ParsedWorkbook {
  fileName: string
  sheets: ParsedSheet[]
}

/** Raw sheet as read-excel-file returns it: data[i][j] is row i + 1, column j + 1. */
export interface RawSheet {
  sheet: string
  data: unknown[][]
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ROWS_PER_SHEET = 5000

export function plainCell(v: unknown): Cell {
  if (v == null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? null : t
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v
  return String(v)
}

/** Turn every sheet into header-keyed rows. The README sheet is skipped. */
export function parseWorkbook(raw: RawSheet[], fileName: string): ParsedWorkbook {
  const sheets: ParsedSheet[] = []
  for (const { sheet, data } of raw) {
    const name = sheet.trim()
    if (name.toLowerCase() === 'readme') continue
    if (name === 'Lists') {
      sheets.push(parseListsSheet(data))
      continue
    }

    const headers = (data[0] ?? []).map((h) => {
      const v = plainCell(h)
      return v == null ? '' : normaliseHeader(String(v))
    })
    while (headers.length && headers[headers.length - 1] === '') headers.pop()

    // Calculated columns hold formulas far below the data, so they don't count towards "has data".
    const def = isSheetName(name) ? SHEETS[name] : undefined
    const calculated = new Set(def?.columns.filter((c) => c.calculated).map((c) => c.key) ?? [])

    const rows: ParsedRow[] = []
    for (let i = 1; i < data.length && rows.length <= MAX_ROWS_PER_SHEET; i++) {
      const cells = data[i] ?? []
      const values: Record<string, Cell> = {}
      let hasInput = false
      headers.forEach((key, j) => {
        if (!key) return
        const value = plainCell(cells[j])
        values[key] = value
        if (value != null && !calculated.has(key)) hasInput = true
      })
      if (hasInput) rows.push({ row: i + 1, values })
    }
    sheets.push({ name, headers, rows })
  }
  return { fileName, sheets }
}

/**
 * Lists has one column per list (Currency, Incoterm...) with values going down.
 * It becomes rows of { list_name, value, sort_order }. Long text in a cell is a
 * note to the reader (the template has one at the bottom), not a list value.
 */
function parseListsSheet(data: unknown[][]): ParsedSheet {
  const rows: ParsedRow[] = []
  ;(data[0] ?? []).forEach((h, col) => {
    const listName = plainCell(h)
    if (listName == null || !(LIST_NAMES as readonly string[]).includes(String(listName))) return
    let order = 0
    for (let i = 1; i < data.length; i++) {
      const value = plainCell(data[i]?.[col])
      if (value == null || String(value).length > 60) continue
      rows.push({ row: i + 1, values: { list_name: String(listName), value: String(value), sort_order: ++order } })
    }
  })
  return { name: 'Lists', headers: ['list_name', 'value', 'sort_order'], rows }
}

/** Read .xlsx bytes. The reader library is loaded only when a file is chosen. */
export async function readXlsx(bytes: ArrayBuffer, fileName: string): Promise<ParsedWorkbook> {
  const { default: readExcelFile } = await import('read-excel-file/universal')
  let raw: RawSheet[]
  try {
    raw = (await readExcelFile(bytes)) as unknown as RawSheet[]
  } catch {
    throw new Error('This file could not be opened. Save it from Excel as "Excel Workbook (.xlsx)" and try again.')
  }
  return parseWorkbook(raw, fileName)
}

/** Browser entry point for the chosen file. */
export async function readXlsxFile(file: File): Promise<ParsedWorkbook> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('This file is not an .xlsx workbook. Save it from Excel as "Excel Workbook (.xlsx)" and try again.')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('This file is larger than 5 MB. Split it into smaller files and import them one by one.')
  }
  return readXlsx(await file.arrayBuffer(), file.name)
}
