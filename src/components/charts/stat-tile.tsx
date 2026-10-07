/** A key number: label, value and an optional line under it. */
export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="grid gap-1 rounded-lg border bg-card p-4 shadow-sm">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-3xl font-semibold tracking-tight ${tone === 'warn' ? 'text-warning' : ''}`}>{value}</span>
      {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
    </div>
  )
}
