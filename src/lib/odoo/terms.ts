const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The due date a buyer's terms suggest for an invoice made today; empty leaves it to Odoo. */
export function suggestedDueDate(terms: string, today = new Date()): string {
  if (terms === '15th of following month') return iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 15)))
  if (terms === 'Prepaid') return iso(today)
  const days = terms.match(/\d+/)?.[0]
  return days ? iso(new Date(today.getTime() + Number(days) * 86_400_000)) : ''
}
