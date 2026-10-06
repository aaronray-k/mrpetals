import type { SupabaseClient } from '@supabase/supabase-js'
import { CODE_SHEET, SHEETS, type CodeKind, type ListName, type SheetName } from '~/lib/import/schema'
import { emptySnapshot, type DbSnapshot } from '~/lib/import/validate'

const PAGE = 1000

/** PostgREST returns at most 1000 rows per request, so page through. */
async function fetchAll<T>(supabase: SupabaseClient, table: string, select: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE - 1)
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

const CODE_TABLE: Record<CodeKind, string> = {
  farm_code: 'farms',
  customer_code: 'customers',
  product_code: 'products',
  box_code: 'box_types',
}

type One<T> = T | T[] | null
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

/** Reads only what the chosen sheet's checks need. */
export async function loadSnapshot(supabase: SupabaseClient, sheet: SheetName): Promise<DbSnapshot> {
  const snap = emptySnapshot()
  const def = SHEETS[sheet]

  const neededCodes = new Set<CodeKind>(def.columns.flatMap((c) => (c.ref ? [c.ref] : [])))
  const ownCode = (Object.keys(CODE_SHEET) as CodeKind[]).find((k) => CODE_SHEET[k] === sheet)
  if (ownCode) neededCodes.add(ownCode)
  await Promise.all(
    [...neededCodes].map(async (kind) => {
      const rows = await fetchAll<Record<string, string>>(supabase, CODE_TABLE[kind], kind)
      snap.codes[kind] = rows.map((r) => r[kind]!)
    }),
  )
  if (ownCode) snap.existingKeys = snap.codes[ownCode]

  const lookups = await fetchAll<{ list_name: string; value: string; active: boolean }>(supabase, 'lookup_values', 'list_name, value, active')
  for (const l of lookups) {
    if (!l.active) continue
    ;(snap.lists[l.list_name as ListName] ??= []).push(l.value)
  }

  switch (sheet) {
    case 'Lists':
      snap.existingKeys = lookups.map((l) => `${l.list_name}|${l.value}`)
      break
    case 'PackRates': {
      const rows = await fetchAll<{ products: One<{ product_code: string }>; box_types: One<{ box_code: string }> }>(
        supabase, 'pack_rates', 'products(product_code), box_types(box_code)')
      snap.existingKeys = rows.map((r) => `${one(r.products)?.product_code}|${one(r.box_types)?.box_code}`)
      break
    }
    case 'PriceList': {
      const rows = await fetchAll<{ valid_from: string; farms: One<{ farm_code: string }>; products: One<{ product_code: string }> }>(
        supabase, 'price_list', 'valid_from, farms(farm_code), products(product_code)')
      snap.existingKeys = rows.map((r) => `${one(r.farms)?.farm_code}|${one(r.products)?.product_code}|${r.valid_from}`)
      break
    }
    case 'FreightRates': {
      const rows = await fetchAll<{ origin_airport: string; destination_airport: string; airline_or_agent: string; valid_from: string }>(
        supabase, 'freight_rates', 'origin_airport, destination_airport, airline_or_agent, valid_from')
      snap.existingKeys = rows.map((r) => `${r.origin_airport}|${r.destination_airport}|${r.airline_or_agent}|${r.valid_from}`)
      break
    }
    case 'PackingList': {
      const [lines, shipments, packRates] = await Promise.all([
        fetchAll<{ line_no: number; shipments: One<{ shipment_ref: string }> }>(supabase, 'packing_list_lines', 'line_no, shipments(shipment_ref)'),
        fetchAll<{ shipment_ref: string; status: string }>(supabase, 'shipments', 'shipment_ref, status'),
        fetchAll<{ products: One<{ product_code: string }>; box_types: One<{ box_code: string }> }>(
          supabase, 'pack_rates', 'products(product_code), box_types(box_code)'),
      ])
      for (const l of lines) {
        const ref = one(l.shipments)?.shipment_ref
        if (!ref) continue
        snap.existingKeys.push(`${ref}|${l.line_no}`)
        snap.shipmentLineCounts[ref] = (snap.shipmentLineCounts[ref] ?? 0) + 1
      }
      snap.closedShipments = shipments.filter((s) => s.status === 'closed').map((s) => s.shipment_ref)
      snap.packRates = packRates.map((r) => `${one(r.products)?.product_code}|${one(r.box_types)?.box_code}`)
      break
    }
  }
  return snap
}
