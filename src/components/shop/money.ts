/** "$0.265" style amounts in the buyer's currency. */
export function money(n: number, currency: string, digits = 2) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
}
