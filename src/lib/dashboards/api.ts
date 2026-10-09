import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'

export type DashboardKind = 'staff' | 'finance' | 'qc' | 'farm' | 'buyer'

/** One role's dashboard: actions, tiles and chart series for the last `weeks` weeks (see dashboard_*() in the database). */
export function useDashboard<T>(kind: DashboardKind, weeks: number) {
  return useQuery({
    queryKey: ['dashboard', kind, weeks],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc(`dashboard_${kind}`, { p_weeks: weeks })
      if (error) throw new Error(error.message)
      return data as T
    },
    refetchInterval: 120_000,
  })
}

export const PERIODS = [
  { weeks: 4, label: '4 weeks' },
  { weeks: 8, label: '8 weeks' },
  { weeks: 26, label: '6 months' },
] as const

const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const month = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
export const weekLabel = (iso: string) => short.format(new Date(`${iso}T00:00:00Z`))
export const monthLabel = (iso: string) => month.format(new Date(`${iso}T00:00:00Z`))

export function money(n: number, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n)
}

/** Groups rows that carry a currency, so amounts are never added across currencies. */
export function byCurrency<T extends { currency: string }>(rows: T[]) {
  const out = new Map<string, T[]>()
  for (const r of rows) out.set(r.currency, [...(out.get(r.currency) ?? []), r])
  return [...out.entries()]
}
