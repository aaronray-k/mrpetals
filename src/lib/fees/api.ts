import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'

export const SERVICES = ['sourcing', 'consolidation', 'intake_qc', 'full_package'] as const
export type Service = (typeof SERVICES)[number]
export const SERVICE_LABELS: Record<Service, string> = {
  sourcing: 'Sourcing',
  consolidation: 'Consolidation',
  intake_qc: 'Intake and quality checks',
  full_package: 'Full package',
}

export interface ServiceFee {
  service: Service
  label: string
  per_stem: boolean
  fee_per_shipment: number
  fee_description: string | null
  currency: string | null
}

export function useServiceFees() {
  return useQuery({
    queryKey: ['service-fees'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('service_fees').select('service, label, per_stem, fee_per_shipment, fee_description, currency')
      if (error) throw new Error(error.message)
      return (data as ServiceFee[])
        .map((f) => ({ ...f, fee_per_shipment: Number(f.fee_per_shipment) }))
        .sort((a, b) => SERVICES.indexOf(a.service) - SERVICES.indexOf(b.service))
    },
  })
}

export async function saveServiceFee(service: Service, patch: Pick<ServiceFee, 'per_stem' | 'fee_per_shipment' | 'fee_description'>) {
  const { data, error } = await getSupabase().from('service_fees').update(patch).eq('service', service).select('service')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Only Admin and Finance users can change fees.')
}

export async function setCustomerService(customerId: string, service: Service) {
  const { data, error } = await getSupabase().from('customers').update({ service }).eq('id', customerId).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Only Admin and Consolidator users can change a buyer\'s service.')
}

/** The signed-in buyer's service and per-shipment fee. */
export function useMyService(enabled = true) {
  return useQuery({
    queryKey: ['my-service'],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('my_service')
      if (error) throw new Error(error.message)
      return data as { service: Service; label: string; per_stem: boolean; fee_per_shipment: number; fee_description: string | null; currency: string } | null
    },
  })
}

/** "US$100 document consolidation fee per shipment", in the buyer's currency (the same figure in € or US$). */
export function serviceFeeText(s: { fee_per_shipment: number; fee_description: string | null; currency: string } | null | undefined) {
  if (!s || !Number(s.fee_per_shipment)) return null
  const amount = new Intl.NumberFormat('en-GB', { style: 'currency', currency: s.currency, maximumFractionDigits: 0 }).format(Number(s.fee_per_shipment))
  return `${amount} ${(s.fee_description ?? 'service fee').toLowerCase()} per shipment`
}
