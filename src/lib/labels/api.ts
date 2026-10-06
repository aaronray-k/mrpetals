import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { parseLayout, type LabelDesign, type Orientation } from './layout'

export interface TemplateSummary {
  id: string
  name: string
  customerId: string | null
  isDefault: boolean
  currentVersion: number
  updatedAt: string
  design: LabelDesign | null
}

export interface TemplateVersion {
  id: string
  version: number
  createdAt: string
  createdBy: string
  createdByName: string
  design: LabelDesign
}

export interface BuyerOption {
  id: string
  code: string
  name: string
  language: string
}

interface DesignRow {
  width_mm: number | string | null
  height_mm: number | string | null
  orientation: Orientation | null
  layout: unknown
}

/** Throws if the stored layout doesn't pass validation (the designer then shows the error). */
function toDesign(r: DesignRow): LabelDesign | null {
  if (r.width_mm == null || r.height_mm == null || !r.orientation || !r.layout) return null
  return { widthMm: Number(r.width_mm), heightMm: Number(r.height_mm), orientation: r.orientation, layout: parseLayout(r.layout) }
}

/** For lists: one unreadable layout shouldn't hide the other templates. */
function toDesignOrNull(r: DesignRow): LabelDesign | null {
  try {
    return toDesign(r)
  } catch {
    return null
  }
}

export const labelKeys = {
  all: ['label_templates'] as const,
  one: (id: string) => ['label_templates', id] as const,
}

export function useTemplates() {
  return useQuery({
    queryKey: labelKeys.all,
    queryFn: async (): Promise<TemplateSummary[]> => {
      const { data, error } = await getSupabase()
        .from('label_templates_current')
        .select('id, name, customer_id, is_default, current_version, updated_at, width_mm, height_mm, orientation, layout')
        .eq('active', true)
        .order('name')
      if (error) throw error
      return (data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        customerId: r.customer_id,
        isDefault: r.is_default,
        currentVersion: r.current_version,
        updatedAt: r.updated_at,
        design: toDesignOrNull(r as DesignRow),
      }))
    },
  })
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: labelKeys.one(id),
    queryFn: async () => {
      const supabase = getSupabase()
      const [t, v] = await Promise.all([
        supabase.from('label_templates').select('id, name, customer_id, is_default, current_version').eq('id', id).maybeSingle(),
        supabase
          .from('label_template_versions')
          .select('id, version, width_mm, height_mm, orientation, layout, created_at, created_by')
          .eq('template_id', id)
          .order('version', { ascending: false }),
      ])
      if (t.error) throw t.error
      if (v.error) throw v.error
      if (!t.data) return null
      const authors = [...new Set((v.data ?? []).map((r) => r.created_by))]
      const { data: people } = authors.length
        ? await supabase.from('profiles').select('id, full_name').in('id', authors)
        : { data: [] as { id: string; full_name: string | null }[] }
      const names = new Map((people ?? []).map((p) => [p.id, p.full_name]))
      const versions: TemplateVersion[] = (v.data ?? []).map((r) => ({
        id: r.id,
        version: r.version,
        createdAt: r.created_at,
        createdBy: r.created_by,
        createdByName: names.get(r.created_by) || 'Unknown user',
        design: toDesign(r as DesignRow)!,
      }))
      return {
        id: t.data.id as string,
        name: t.data.name as string,
        customerId: t.data.customer_id as string | null,
        isDefault: t.data.is_default as boolean,
        currentVersion: t.data.current_version as number,
        versions,
      }
    },
  })
}

export function useBuyers() {
  return useQuery({
    queryKey: ['buyers'],
    queryFn: async (): Promise<BuyerOption[]> => {
      const { data, error } = await getSupabase()
        .from('customers')
        .select('id, customer_code, company_name, language')
        .eq('active', true)
        .order('company_name')
      if (error) throw error
      return (data ?? []).map((c) => ({ id: c.id, code: c.customer_code, name: c.company_name, language: c.language }))
    },
  })
}

export interface SaveTemplateInput {
  templateId: string | null
  name: string
  customerId: string | null
  isDefault: boolean
  design: LabelDesign
  expectedVersion: number | null
}

/** Saves a new version. Returns the template id and the new version number. */
export async function saveTemplate(input: SaveTemplateInput): Promise<{ templateId: string; version: number }> {
  const { data, error } = await getSupabase().rpc('save_label_template', {
    p_template_id: input.templateId,
    p_name: input.name,
    p_customer_id: input.customerId,
    p_is_default: input.isDefault,
    p_width_mm: input.design.widthMm,
    p_height_mm: input.design.heightMm,
    p_orientation: input.design.orientation,
    p_layout: input.design.layout,
    p_expected_version: input.expectedVersion,
  })
  if (error) throw new Error(error.message)
  const r = data as { template_id: string; version: number }
  return { templateId: r.template_id, version: r.version }
}
