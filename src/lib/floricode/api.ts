import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { getFloricodeSource, syncFloricode } from '~/server/floricode.functions'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

export type CodeStatus = 'active' | 'blocked'

export interface FloricodeProduct {
  code: string
  name: string
  latin_name: string | null
  product_group: string | null
  status: CodeStatus
  replaced_by: string | null
}
export interface FeatureType {
  code: string
  name: string
  product_field: 'stem_length_cm' | 'head_size_cm' | 'maturity' | 'grade' | null
  status: CodeStatus
}
export interface FeatureValue {
  feature_type: string
  code: string
  name: string
  numeric_value: number | null
  status: CodeStatus
}
export interface Packaging {
  code: string
  name: string
  length_cm: number | null
  width_cm: number | null
  height_cm: number | null
  status: CodeStatus
}
export interface Company {
  code: string
  gln: string | null
  name: string
  country: string | null
  kind: string | null
  status: CodeStatus
}
export interface SyncChange {
  kind: 'product' | 'new_product' | 'feature_value'
  code: string
  detail: string
}
export interface SyncRun {
  id: number
  source: 'api' | 'demo'
  status: 'running' | 'ok' | 'failed'
  started_at: string
  finished_at: string | null
  counts: { products?: number; feature_types?: number; feature_values?: number; packaging?: number; companies?: number }
  changes: SyncChange[]
  message: string | null
}

/** Everything the product form and the codes browser need, in one go. */
export function useFloricode() {
  return useQuery({
    queryKey: ['floricode'],
    queryFn: async () => {
      const s = getSupabase()
      const [products, featureTypes, featureValues, packaging] = await Promise.all([
        rows<FloricodeProduct>(s.from('floricode_products').select('*').order('name')),
        rows<FeatureType>(s.from('floricode_feature_types').select('*').order('code')),
        rows<FeatureValue>(s.from('floricode_feature_values').select('*').order('feature_type').order('numeric_value', { nullsFirst: false }).order('code')),
        rows<Packaging>(s.from('floricode_packaging').select('*').order('code')),
      ])
      return { products, featureTypes, featureValues, packaging }
    },
    staleTime: 60_000,
  })
}

export function useFloricodeCompanies(enabled: boolean) {
  return useQuery({
    queryKey: ['floricode-companies'],
    enabled,
    queryFn: () => rows<Company>(getSupabase().from('floricode_companies').select('*').order('name')),
  })
}

export function useSyncRuns() {
  return useQuery({
    queryKey: ['floricode-runs'],
    queryFn: () => rows<SyncRun>(getSupabase().from('floricode_sync_runs').select('*').order('id', { ascending: false }).limit(10)),
  })
}

export function useFloricodeSource() {
  return useQuery({ queryKey: ['floricode-source'], queryFn: () => getFloricodeSource(), staleTime: Infinity })
}

export const runFloricodeSync = () => syncFloricode()

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductRow {
  id: string
  product_code: string
  flower_type: string
  variety: string
  colour: string | null
  vbn_code: string | null
  grade: string
  stem_length_cm: number
  head_size_cm: number | null
  maturity: string | null
  stems_per_bunch: number
  default_farm_id: string | null
  active: boolean
  floricode_features: Record<string, string>
}

export interface ProductReview {
  id: number
  product_id: string
  reason: 'missing_code' | 'unknown_code' | 'blocked' | 'changed' | 'feature_blocked'
  detail: string
  created_at: string
}

export const REVIEW_LABELS: Record<ProductReview['reason'], string> = {
  missing_code: 'No VBN code',
  unknown_code: 'Unknown code',
  blocked: 'Code blocked',
  changed: 'Code changed',
  feature_blocked: 'Feature blocked',
}

export function useProducts() {
  return useQuery({
    queryKey: ['products-floricode'],
    queryFn: () =>
      rows<ProductRow>(
        getSupabase()
          .from('products')
          .select('id, product_code, flower_type, variety, colour, vbn_code, grade, stem_length_cm, head_size_cm, maturity, stems_per_bunch, default_farm_id, active, floricode_features')
          .order('product_code'),
      ),
  })
}

/** Open flags; staff only (others get none under RLS). */
export function useProductReviews(enabled: boolean) {
  return useQuery({
    queryKey: ['product-reviews'],
    enabled,
    queryFn: () => rows<ProductReview>(getSupabase().from('product_reviews').select('id, product_id, reason, detail, created_at').is('resolved_at', null).order('created_at')),
  })
}

export interface ProductInput {
  product_code: string
  flower_type: string
  variety: string
  colour: string
  vbn_code: string | null
  stems_per_bunch: number
  default_farm_id: string | null
  active: boolean
  floricode_features: Record<string, string>
}

export const saveProduct = (id: string | null, p: ProductInput) => rpc<string>('save_product', { p_id: id, p })
export const resolveProductReview = (id: number) => rpc<void>('resolve_product_review', { p_review_id: id })
export const setBoxPackagingCode = (boxTypeId: string, code: string) => rpc<void>('set_box_packaging_code', { p_box_type_id: boxTypeId, p_code: code })
