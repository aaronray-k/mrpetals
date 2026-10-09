import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { SHEET_ORDER, type SheetName } from '~/lib/import/schema'
import { MAX_ROWS_PER_SHEET, type ParsedWorkbook } from '~/lib/import/parse'
import { validateSheet, type Issue } from '~/lib/import/validate'
import { STAFF_ROLES } from '~/lib/roles'
import { authMiddleware, requireRoles } from './auth'
import { loadSnapshot } from './import-snapshot'

const cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])
const payload = z.object({
  sheet: z.enum(SHEET_ORDER),
  workbook: z.object({
    fileName: z.string().min(1).max(255),
    sheets: z
      .array(
        z.object({
          name: z.string().max(100),
          headers: z.array(z.string().max(100)).max(100),
          rows: z.array(z.object({ row: z.number().int().positive(), values: z.record(z.string(), cell) })).max(MAX_ROWS_PER_SHEET + 1),
        }),
      )
      .max(20),
  }),
})

export interface DryRunResponse {
  sheet: SheetName
  ok: boolean
  issues: Issue[]
  counts: { total: number; inserts: number; updates: number }
}

/** Dry run: checks the chosen sheet against the file and the database. Writes nothing. */
export const dryRunImport = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(payload)
  .handler(async ({ data, context }): Promise<DryRunResponse> => {
    requireRoles(context, STAFF_ROLES)
    const snapshot = await loadSnapshot(context.supabase, data.sheet)
    const { rows: _rows, ...result } = validateSheet(data.workbook as ParsedWorkbook, data.sheet, snapshot)
    return result
  })

export type ImportResponse =
  | { status: 'imported'; inserted: number; updated: number; total: number }
  | { status: 'blocked'; dryRun: DryRunResponse }
  | { status: 'failed'; message: string }

/**
 * Import one sheet. The dry run is repeated here so nothing unchecked is ever
 * written, even if the page was tampered with or the data changed meanwhile.
 */
export const runImport = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(payload)
  .handler(async ({ data, context }): Promise<ImportResponse> => {
    requireRoles(context, STAFF_ROLES)
    const snapshot = await loadSnapshot(context.supabase, data.sheet)
    const { rows, ...dryRun } = validateSheet(data.workbook as ParsedWorkbook, data.sheet, snapshot)
    if (!dryRun.ok) return { status: 'blocked', dryRun }

    const { data: res, error } = await context.supabase.rpc('import_sheet', {
      p_sheet: data.sheet,
      p_file_name: data.workbook.fileName,
      p_rows: rows,
    })
    if (error) {
      // The import rolled back as a whole; record the failure separately.
      await context.supabase.from('import_runs').insert({
        file_name: data.workbook.fileName,
        sheet: data.sheet,
        status: 'failed',
        rows_total: rows.length,
        message: error.message,
      })
      return { status: 'failed', message: error.message }
    }
    const r = res as { inserted: number; updated: number; total: number }
    return { status: 'imported', ...r }
  })
