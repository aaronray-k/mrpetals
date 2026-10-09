import { createServerFn } from '@tanstack/react-start'
import { authMiddleware, requireRoles } from './auth'
import demo from './floricode-demo.json'

/**
 * Floricode master data comes in through the app server, never the browser.
 *
 * - FLORICODE_SOURCE=demo: the preview's demo data (src/server/floricode-demo.json). The first sync
 *   loads the full list; later syncs bring a set of changes, the way Floricode delivers them.
 * - FLORICODE_API_URL and FLORICODE_API_KEY: the real Floricode API. The client below is waiting for
 *   ConsolFlora's Floricode account and API documentation; until then a sync logs a clear failure.
 *
 * Either way the rows go to floricode_apply_sync(), which checks the caller is an Admin.
 */
export type FloricodeSource = 'demo' | 'api' | 'none'

function source(): FloricodeSource {
  if (process.env.FLORICODE_SOURCE === 'demo') return 'demo'
  if (process.env.FLORICODE_API_URL && process.env.FLORICODE_API_KEY) return 'api'
  return 'none'
}

interface SyncData {
  products?: unknown[]
  feature_types?: unknown[]
  feature_values?: unknown[]
  packaging?: unknown[]
  companies?: unknown[]
}

async function fetchFromApi(_cursor: string | null): Promise<{ data: SyncData; cursor: string }> {
  throw new Error('The Floricode API connection is not built yet: it needs ConsolFlora\'s Floricode account and API documentation. See docs/backend.md.')
}

export const getFloricodeSource = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => ({ source: source() }))

export const syncFloricode = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, ['admin'])
    const src = source()
    if (src === 'none') throw new Error('Floricode is not connected. Add FLORICODE_API_URL and FLORICODE_API_KEY to the server environment.')

    const { data: last } = await context.supabase
      .from('floricode_sync_runs')
      .select('cursor')
      .eq('status', 'ok')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    const cursor = (last?.cursor as string | null | undefined) ?? null

    let batch: { data: SyncData; cursor: string }
    try {
      batch = src === 'demo' ? { data: cursor ? demo.update : demo.initial, cursor: cursor ? 'demo-update' : 'demo-initial' } : await fetchFromApi(cursor)
    } catch (e) {
      await context.supabase.rpc('floricode_log_failure', { p_source: src, p_message: (e as Error).message })
      throw e
    }
    const { data, error } = await context.supabase.rpc('floricode_apply_sync', { p_source: src, p_cursor: batch.cursor, p_data: batch.data })
    if (error) {
      await context.supabase.rpc('floricode_log_failure', { p_source: src, p_message: error.message })
      throw new Error(error.message)
    }
    return data as { run_id: number; changes: number; flagged: number }
  })
