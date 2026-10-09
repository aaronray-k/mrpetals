import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { parseMasterWorkbook, type RawSheet } from './parse'
import { importPlan, type CataloguePhoto, type ImportPlan } from './plan'

/** The master file (up to 15 MB) and the catalogue's photo list, into an import plan. Nothing is saved. */
export async function planFromFile(file: File): Promise<ImportPlan> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('This file is not an .xlsx workbook. Save it from Excel as "Excel Workbook (.xlsx)".')
  if (file.size > 15 * 1024 * 1024) throw new Error('This file is larger than 15 MB.')
  const { default: readExcelFile } = await import('read-excel-file/universal')
  let raw: RawSheet[]
  try {
    raw = (await readExcelFile(await file.arrayBuffer())) as unknown as RawSheet[]
  } catch {
    throw new Error('This file could not be opened. Save it from Excel as "Excel Workbook (.xlsx)" and try again.')
  }
  const parsed = parseMasterWorkbook(raw)
  if (!parsed.rows.length) throw new Error('No prices found. Is this the master price file (sheets with Category, Variety, Farm and lengths)?')
  const catalogue = (await (await fetch('/catalogue/index.json')).json()) as { items: CataloguePhoto[] }
  return importPlan(parsed, catalogue.items)
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

/** Saves the plan: farms, then varieties, then prices in batches. Reports progress from 0 to 1. */
export async function applyPlan(plan: ImportPlan, onProgress: (done: number, what: string) => void) {
  const BATCH = 400
  const steps = 2 + Math.ceil(plan.offers.length / BATCH)
  let step = 0
  onProgress(0, 'Farms')
  const farmIds = await rpc<Record<string, string>>('master_import_farms', { p_farms: plan.farms })
  onProgress(++step / steps, 'Varieties')
  const varietyIds: Record<string, string> = {}
  for (let i = 0; i < plan.varieties.length; i += BATCH) {
    const part = plan.varieties.slice(i, i + BATCH).map((v) => ({ key: v.key, flower_type: v.flowerType, name: v.name, grade: v.grade, colour: v.colour, photo: v.photo, spellings: v.spellings }))
    Object.assign(varietyIds, await rpc<Record<string, string>>('master_import_varieties', { p_varieties: part }))
  }
  onProgress(++step / steps, 'Prices')
  let saved = 0
  for (let i = 0; i < plan.offers.length; i += BATCH) {
    const part = plan.offers.slice(i, i + BATCH).map((o) => ({
      farm_id: farmIds[o.farm],
      variety_id: varietyIds[o.variety],
      length_cm: o.lengthCm,
      head_size_cm: o.headSizeCm,
      currency: o.currency,
      price: o.price,
      fob_margin: o.fobMargin,
      cif_margin: o.cifMargin,
      stems_per_box: o.stemsPerBox,
      box_weight_kg: o.boxWeightKg,
      trucking_per_box: o.truckingPerBox,
      trucking_per_stem: o.truckingPerStem,
    }))
    saved += await rpc<number>('master_import_offers', { p_offers: part })
    onProgress(++step / steps, `Prices: ${saved.toLocaleString('en-GB')} of ${plan.offers.length.toLocaleString('en-GB')}`)
  }
  return { farms: Object.keys(farmIds).length, varieties: Object.keys(varietyIds).length, prices: saved }
}

export interface CostingSettings {
  freight_per_kg: number
  freight_currency: string
  trucking_enabled: boolean
  updated_at: string
}
export function useCostingSettings() {
  return useQuery({
    queryKey: ['costing-settings'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('costing_settings').select('freight_per_kg, freight_currency, trucking_enabled, updated_at').maybeSingle()
      if (error) throw new Error(error.message)
      return data ? ({ ...data, freight_per_kg: Number(data.freight_per_kg) } as CostingSettings) : null
    },
  })
}
export async function saveCostingSettings(s: Pick<CostingSettings, 'freight_per_kg' | 'freight_currency' | 'trucking_enabled'>) {
  await rpc('set_costing_settings', { p_freight_per_kg: s.freight_per_kg, p_freight_currency: s.freight_currency, p_trucking_enabled: s.trucking_enabled })
}
