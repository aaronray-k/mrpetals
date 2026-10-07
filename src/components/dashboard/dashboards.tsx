import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { byCurrency, money, monthLabel, useDashboard, weekLabel } from '~/lib/dashboards/api'
import { formatDate } from '~/components/orders/shipment-status'
import { BarList } from '~/components/charts/bar-list'
import { ChartCard, compact } from '~/components/charts/chart-card'
import { ColumnChart } from '~/components/charts/column-chart'
import { StatTile } from '~/components/charts/stat-tile'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { ActionGroup, ActionsCard, type ActionItem } from './action-list'
import { useClaims, useFarmNotices } from '~/lib/claims/api'
import { useInvoices } from '~/lib/odoo/api'

const S1 = 'var(--series-1)'
const S2 = 'var(--series-2)'
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')
const n = (v: unknown) => Number(v ?? 0)

function Loading({ q }: { q: { isLoading: boolean; error: unknown } }) {
  if (q.isLoading) return <Spinner />
  if (q.error) return <Alert variant="destructive" title="Couldn't load the dashboard" role="alert">{(q.error as Error).message}</Alert>
  return null
}

const Tiles = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
const Charts = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{children}</div>

// ---------------------------------------------------------------------------
// Consolidator / Admin
// ---------------------------------------------------------------------------
interface StaffData {
  actions: {
    to_approve: { order_id: string; order_number: string; buyer: string; ship_date: string | null; created_at: string }[]
    short_lines: { order_id: string; order_number: string; buyer: string; line_no: number; product: string; short: number; ship_date: string | null }[]
    unanswered_pos: { po_id: string; po_number: string; farm: string; order_id: string; sent_at: string; delivery_date: string | null }[]
    ready_for_packing: { order_id: string; order_number: string; buyer: string; ship_date: string | null }[]
    flights_soon: { shipment_id: string; shipment_ref: string; flight_date: string; blockers: string[] }[]
    products_to_review?: { product_id: string; product_code: string; product: string; reasons: string[] }[]
  }
  tiles: { open_orders: number; stems_ordered: number; pos_waiting: number; boxes_waiting_qc: number }
  stems_per_week: { week: string; stems: number }[]
  fill_rate_by_farm: { farm: string; asked: number; confirmed: number }[]
  margin_per_week: { week: string; currency: string; margin: number }[]
  buyers: {
    customer_id: string
    company_name: string
    customer_code: string
    currency: string
    orders: { order_id: string; order_number: string; status: string; ship_date: string | null; stems: number; placed: number; confirmed: number; packing_list: boolean }[]
  }[]
}

export function StaffDashboard({ weeks }: { weeks: number }) {
  const q = useDashboard<StaffData>('staff', weeks)
  const claims = useClaims()
  const notices = useFarmNotices()
  if (!q.data) return <Loading q={q} />
  const d = q.data
  const a = d.actions
  const order = (id: string) => ({ to: '/orders/$orderId', params: { orderId: id } })
  const groups: { title: string; empty: string; items: ActionItem[] }[] = [
    { title: 'Orders to approve', empty: 'No new orders.', items: a.to_approve.map((o) => ({ key: o.order_id, title: `${o.order_number} · ${o.buyer}`, detail: o.ship_date ? `Ships ${formatDate(o.ship_date)}` : 'No ship date yet', ...order(o.order_id) })) },
    {
      title: 'Stems still to place with farms',
      empty: 'Every line is placed.',
      items: a.short_lines.map((l) => ({ key: `${l.order_id}-${l.line_no}`, title: `${l.order_number}: ${l.short.toLocaleString('en-GB')} stems of ${l.product}`, detail: `${l.buyer} · ships ${formatDate(l.ship_date)}`, ...order(l.order_id) })),
    },
    {
      title: 'Farms not answering (over 24 hours)',
      empty: 'All farms have answered.',
      items: a.unanswered_pos.map((p) => ({ key: p.po_id, title: `${p.po_number} · ${p.farm}`, detail: `Sent ${formatDate(p.sent_at.slice(0, 10))} · deliver by ${formatDate(p.delivery_date)}`, ...order(p.order_id) })),
    },
    { title: 'Ready for the packing list', empty: 'Nothing waiting.', items: a.ready_for_packing.map((o) => ({ key: o.order_id, title: `${o.order_number} · ${o.buyer}`, detail: `Every stem confirmed · ships ${formatDate(o.ship_date)}`, ...order(o.order_id) })) },
    {
      title: 'Flights in the next 3 days, not cleared',
      empty: 'Every flight is cleared.',
      items: a.flights_soon.map((s) => ({ key: s.shipment_id, title: `${s.shipment_ref} · ${formatDate(s.flight_date)}`, detail: s.blockers.slice(0, 2).join('; '), urgent: true, to: '/shipments/$shipmentId', params: { shipmentId: s.shipment_id } })),
    },
    {
      title: 'Buyer claims to review',
      empty: 'No claims waiting.',
      items: (claims.data ?? [])
        .filter((c) => c.status === 'submitted')
        .map((c) => ({ key: c.id, title: `${c.claim_number} · ${c.customers?.company_name ?? ''}`, detail: `${c.claim_lines.length} boxes · shipment ${c.shipments?.shipment_ref ?? ''}`, urgent: true, to: '/claims/$claimId', params: { claimId: c.id } })),
    },
    {
      title: 'Farm replies on claim notices',
      empty: 'Nothing from farms.',
      items: (notices.data ?? [])
        .filter((n) => n.status === 'queried' || n.status === 'credited')
        .map((n) => ({ key: n.id, title: `${n.notice_number} · ${n.farms?.farm_name ?? ''}`, detail: n.status === 'queried' ? 'Has a question' : `Credit note ${n.credit_note_number} to check and close`, to: '/claims/$claimId', params: { claimId: n.claim_id } })),
    },
    {
      title: 'Products to review (Floricode)',
      empty: 'Every product\'s codes are in order.',
      items: (a.products_to_review ?? []).map((p) => ({ key: p.product_id, title: `${p.product_code} · ${p.product}`, detail: p.reasons.join(' '), to: '/products', search: { review: true } })),
    },
  ]
  const fills = d.fill_rate_by_farm
  const asked = fills.reduce((s, f) => s + f.asked, 0)
  const conf = fills.reduce((s, f) => s + f.confirmed, 0)

  return (
    <div className="grid gap-4">
      <ActionsCard total={groups.reduce((s, g) => s + g.items.length, 0)}>
        {groups.map((g) => (
          <ActionGroup key={g.title} {...g} />
        ))}
      </ActionsCard>
      <Tiles>
        <StatTile label="Open orders" value={compact(d.tiles.open_orders)} />
        <StatTile label="Stems ordered in the period" value={compact(n(d.tiles.stems_ordered))} />
        <StatTile label="Farm fill rate" value={pct(conf, asked)} sub={asked ? `${compact(conf)} of ${compact(asked)} stems confirmed` : 'No farm answers yet'} />
        <StatTile label="Boxes waiting for QC" value={compact(d.tiles.boxes_waiting_qc)} sub={`${d.tiles.pos_waiting} POs waiting for farms`} />
      </Tiles>
      <BuyersPanel buyers={d.buyers} />
      <Charts>
        <ChartCard
          title="Stems ordered per week"
          description="New and approved orders, by the week they were placed."
          table={{ columns: ['Week', 'Stems'], rows: d.stems_per_week.map((w) => [weekLabel(w.week), n(w.stems)]) }}
        >
          <ColumnChart ariaLabel="Stems ordered per week" data={d.stems_per_week.map((w) => ({ label: weekLabel(w.week), values: { stems: n(w.stems) } }))} series={[{ key: 'stems', label: 'Stems', color: S1 }]} />
        </ChartCard>
        <ChartCard
          title="Farm fill rate"
          description="Stems confirmed out of stems asked, per farm, for POs answered in the period."
          table={{ columns: ['Farm', 'Asked', 'Confirmed', 'Fill rate'], rows: fills.map((f) => [f.farm, f.asked, f.confirmed, pct(f.confirmed, f.asked)]) }}
          empty="No farm answers in this period."
        >
          <BarList rows={fills.map((f) => ({ label: f.farm, value: f.confirmed, of: f.asked, note: `${pct(f.confirmed, f.asked)} · ${compact(f.confirmed)} of ${compact(f.asked)}`, warn: f.confirmed < f.asked * 0.8 }))} />
        </ChartCard>
        {byCurrency(d.margin_per_week).map(([cur, rows]) => (
          <ChartCard
            key={cur}
            title={`ConsolFlora margin per week (${cur})`}
            description={`Confirmed farm lines on ${cur} orders. Amounts in other currencies are shown separately.`}
            table={{ columns: ['Week', `Margin (${cur})`], rows: rows.map((r) => [weekLabel(r.week), money(n(r.margin), cur)]) }}
          >
            <ColumnChart ariaLabel={`Margin per week in ${cur}`} format={(v) => money(v, cur)} data={rows.map((r) => ({ label: weekLabel(r.week), values: { margin: n(r.margin) } }))} series={[{ key: 'margin', label: 'Margin', color: S1 }]} />
          </ChartCard>
        ))}
      </Charts>
    </div>
  )
}

/** Open orders grouped by buyer; each buyer opens out to its orders, linking to where farms are allocated. */
function BuyersPanel({ buyers }: { buyers: StaffData['buyers'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Orders by buyer</CardTitle>
        <CardDescription>Open a buyer to see their orders; open an order to place it with farms.</CardDescription>
      </CardHeader>
      <CardContent>
        {buyers.length === 0 ? (
          <p className="text-muted-foreground">No open orders.</p>
        ) : (
          <ul className="grid divide-y rounded-md border">
            {buyers.map((b) => {
              const stems = b.orders.reduce((s, o) => s + o.stems, 0)
              const placed = b.orders.reduce((s, o) => s + Math.min(o.placed, o.stems), 0)
              const waiting = b.orders.filter((o) => o.status === 'submitted').length
              return (
                <li key={b.customer_id}>
                  <details className="group">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3 py-2 hover:bg-muted [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                      <span className="grid flex-1">
                        <span className="font-semibold">
                          {b.company_name} ({b.customer_code}) · {b.currency}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {b.orders.length} {b.orders.length === 1 ? 'order' : 'orders'} · {compact(stems)} stems · {pct(placed, stems)} placed with farms
                        </span>
                      </span>
                      {waiting > 0 && <Badge variant="warning">{waiting} to approve</Badge>}
                    </summary>
                    <ul className="grid gap-1 px-3 pb-3 pl-10">
                      {b.orders.map((o) => (
                        <li key={o.order_id}>
                          <Link to="/orders/$orderId" params={{ orderId: o.order_id }} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 hover:bg-muted">
                            <span className="font-semibold underline-offset-2 hover:underline">{o.order_number}</span>
                            <span className="text-sm">{o.ship_date ? `Ships ${formatDate(o.ship_date)}` : 'No ship date yet'}</span>
                            <span className="text-sm tabular-nums">
                              {compact(o.stems)} stems · {pct(Math.min(o.placed, o.stems), o.stems)} placed · {pct(Math.min(o.confirmed, o.stems), o.stems)} confirmed
                            </span>
                            {o.status === 'submitted' ? <Badge variant="warning">Waiting for approval</Badge> : o.packing_list ? <Badge variant="success">Packing list ready</Badge> : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
interface FinanceData {
  actions: {
    unpaid_prepaid: { order_id: string; order_number: string; buyer: string; ship_date: string; value: number; currency: string }[]
    over_limit: { customer_id: string; buyer: string; open_value: number; credit_limit: number; currency: string }[]
    no_grower_price: { order_id: string; order_number: string; farm: string; product: string }[]
    missing_rates: { from: string; to: string }[]
  }
  tiles: { unpaid: { currency: string; value: number }[]; paid_in_period: { currency: string; value: number }[]; buyers_over_limit: number }
  credit: { buyer: string; currency: string; open_value: number; credit_limit: number }[]
  paid_unpaid_per_week: { week: string; currency: string; paid: number; unpaid: number }[]
  margin_by_incoterm: { incoterm: string; currency: string; margin: number }[]
}

export function FinanceDashboard({ weeks }: { weeks: number }) {
  const q = useDashboard<FinanceData>('finance', weeks)
  const invoices = useInvoices()
  if (!q.data) return <Loading q={q} />
  const d = q.data
  const a = d.actions
  const groups: { title: string; empty: string; items: ActionItem[] }[] = [
    {
      title: 'Draft invoices to confirm',
      empty: 'No drafts waiting.',
      items: (invoices.data ?? [])
        .filter((i) => i.status === 'pushed' && i.odoo_state === 'draft')
        .map((i) => ({ key: i.id, title: `${i.customers?.company_name ?? ''} · ${money(i.kind === 'credit_note' ? -i.amount : i.amount, i.currency)}`, detail: i.reference, to: '/invoices/$invoiceId', params: { invoiceId: i.id } })),
    },
    {
      title: 'Invoices not in Odoo yet',
      empty: 'Every invoice is in Odoo.',
      items: (invoices.data ?? [])
        .filter((i) => i.status !== 'pushed')
        .map((i) => ({ key: i.id, title: `${i.customers?.company_name ?? ''} · ${money(i.amount, i.currency)}`, detail: i.last_error ?? i.reference, urgent: i.status === 'failed', to: '/invoices/$invoiceId', params: { invoiceId: i.id } })),
    },
    {
      title: 'Prepaid orders to collect (flights within 7 days)',
      empty: 'Nothing waiting for payment.',
      items: a.unpaid_prepaid.map((o) => ({ key: o.order_id, title: `${o.order_number} · ${o.buyer}`, detail: `${money(n(o.value), o.currency)} · ships ${formatDate(o.ship_date)}`, urgent: true, to: '/orders/$orderId', params: { orderId: o.order_id } })),
    },
    { title: 'Buyers over their credit limit', empty: 'Every buyer is within their limit.', items: a.over_limit.map((b) => ({ key: b.customer_id, title: b.buyer, detail: `${money(n(b.open_value), b.currency)} open, limit ${money(n(b.credit_limit), b.currency)}` })) },
    { title: 'Farm lines without a grower price', empty: 'Every line has a price.', items: a.no_grower_price.map((l, i) => ({ key: `${l.order_id}-${i}`, title: `${l.order_number} · ${l.farm}`, detail: l.product, to: '/orders/$orderId', params: { orderId: l.order_id } })) },
    {
      title: 'Exchange rates missing',
      empty: 'Every buyer currency has a rate.',
      items: a.missing_rates.map((r) => ({ key: `${r.from}-${r.to}`, title: `${r.from} to ${r.to}`, detail: `Buyers paying in ${r.to} see no prices until this rate is set.`, urgent: true, to: '/exchange-rates' })),
    },
  ]
  const fmtList = (rows: { currency: string; value: number }[]) => (rows.length ? rows.map((r) => money(n(r.value), r.currency)).join(' · ') : '0')

  return (
    <div className="grid gap-4">
      <ActionsCard total={groups.reduce((s, g) => s + g.items.length, 0)}>
        {groups.map((g) => (
          <ActionGroup key={g.title} {...g} />
        ))}
      </ActionsCard>
      <Tiles>
        <StatTile label="Unpaid, open orders" value={fmtList(d.tiles.unpaid)} />
        <StatTile label="Paid in the period" value={fmtList(d.tiles.paid_in_period)} />
        <StatTile label="Buyers over their limit" value={String(d.tiles.buyers_over_limit)} tone={d.tiles.buyers_over_limit ? 'warn' : undefined} />
      </Tiles>
      <Charts>
        <ChartCard
          title="Credit use per buyer"
          description="Open, unpaid orders against each credit buyer's limit (the line), in the buyer's currency."
          table={{ columns: ['Buyer', 'Open', 'Limit'], rows: d.credit.map((c) => [c.buyer, money(n(c.open_value), c.currency), money(n(c.credit_limit), c.currency)]) }}
          empty="No credit buyers with a limit."
        >
          <BarList rows={d.credit.map((c) => ({ label: `${c.buyer} (${c.currency})`, value: n(c.open_value), limit: n(c.credit_limit), note: `${money(n(c.open_value), c.currency)} of ${money(n(c.credit_limit), c.currency)}`, warn: n(c.open_value) > n(c.credit_limit) }))} />
        </ChartCard>
        {byCurrency(d.paid_unpaid_per_week).map(([cur, rows]) => (
          <ChartCard
            key={cur}
            title={`Order value per week, paid and unpaid (${cur})`}
            table={{ columns: ['Week', 'Paid', 'Unpaid'], rows: rows.map((r) => [weekLabel(r.week), money(n(r.paid), cur), money(n(r.unpaid), cur)]) }}
          >
            <ColumnChart
              ariaLabel={`Paid and unpaid order value per week in ${cur}`}
              format={(v) => money(v, cur)}
              data={rows.map((r) => ({ label: weekLabel(r.week), values: { paid: n(r.paid), unpaid: n(r.unpaid) } }))}
              series={[
                { key: 'paid', label: 'Paid', color: S1 },
                { key: 'unpaid', label: 'Unpaid', color: S2 },
              ]}
            />
          </ChartCard>
        ))}
        {byCurrency(d.margin_by_incoterm).map(([cur, rows]) => (
          <ChartCard key={cur} title={`Margin by incoterm (${cur})`} table={{ columns: ['Incoterm', `Margin (${cur})`], rows: rows.map((r) => [r.incoterm, money(n(r.margin), cur)]) }}>
            <BarList format={(v) => money(v, cur)} rows={rows.map((r) => ({ label: r.incoterm, value: n(r.margin) }))} />
          </ChartCard>
        ))}
      </Charts>
    </div>
  )
}

// ---------------------------------------------------------------------------
// QC
// ---------------------------------------------------------------------------
interface QcData {
  actions: {
    waiting_by_shipment: { shipment_id: string; shipment_ref: string; flight_date: string | null; not_received: number; not_checked: number }[]
    major_to_clear: { box_id: number; shipment_id: string; shipment_ref: string; farm: string; reasons: string[] }[]
    stickers_to_print: { box_id: number; shipment_id: string; shipment_ref: string; farm: string }[]
  }
  tiles: { checked: number; passed: number; back_to_farm: number; major_open: number }
  reasons: { reason: string; boxes: number }[]
  pass_rate_by_farm: { farm: string; checked: number; passed: number }[]
}

export function QcDashboard({ weeks, canClear }: { weeks: number; canClear: boolean }) {
  const q = useDashboard<QcData>('qc', weeks)
  if (!q.data) return <Loading q={q} />
  const d = q.data
  const a = d.actions
  const ship = (id: string) => ({ to: '/shipments/$shipmentId', params: { shipmentId: id } })
  const groups: { title: string; empty: string; items: ActionItem[] }[] = [
    {
      title: 'Boxes waiting, by flight',
      empty: 'Every box is checked.',
      items: a.waiting_by_shipment.map((s) => ({ key: s.shipment_id, title: `${s.shipment_ref} · ${formatDate(s.flight_date)}`, detail: `${s.not_received} not scanned in · ${s.not_checked} waiting for a result`, to: '/qc/scan' })),
    },
    {
      title: canClear ? 'Major failures to clear' : 'Major failures (Senior QC clears)',
      empty: 'No Major failures open.',
      items: a.major_to_clear.map((b) => ({ key: String(b.box_id), title: `Box ${b.box_id} · ${b.farm}`, detail: `${b.shipment_ref} · ${b.reasons.join(', ')}`, ...ship(b.shipment_id) })),
    },
    { title: 'BACK TO FARM stickers to print', empty: 'Every returned box has its sticker.', items: a.stickers_to_print.map((b) => ({ key: String(b.box_id), title: `Box ${b.box_id} · ${b.farm}`, detail: b.shipment_ref, urgent: true, ...ship(b.shipment_id) })) },
  ]
  return (
    <div className="grid gap-4">
      <ActionsCard total={groups.reduce((s, g) => s + g.items.length, 0)}>
        {groups.map((g) => (
          <ActionGroup key={g.title} {...g} />
        ))}
      </ActionsCard>
      <Tiles>
        <StatTile label="Boxes checked in the period" value={compact(d.tiles.checked)} />
        <StatTile label="Pass rate" value={pct(d.tiles.passed, d.tiles.checked)} />
        <StatTile label="Sent back to farm" value={compact(d.tiles.back_to_farm)} />
        <StatTile label="Major failures open" value={compact(d.tiles.major_open)} tone={d.tiles.major_open ? 'warn' : undefined} />
      </Tiles>
      <Charts>
        <ChartCard title="Why boxes were flagged" description="Boxes with each reason (Minor, Major and Back to farm)." table={{ columns: ['Reason', 'Boxes'], rows: d.reasons.map((r) => [r.reason, r.boxes]) }} empty="No boxes flagged in this period.">
          <BarList rows={d.reasons.map((r) => ({ label: r.reason, value: r.boxes }))} />
        </ChartCard>
        <ChartCard title="Pass rate per farm" table={{ columns: ['Farm', 'Checked', 'Passed', 'Pass rate'], rows: d.pass_rate_by_farm.map((f) => [f.farm, f.checked, f.passed, pct(f.passed, f.checked)]) }} empty="No boxes checked in this period.">
          <BarList rows={d.pass_rate_by_farm.map((f) => ({ label: f.farm, value: f.passed, of: f.checked, note: `${pct(f.passed, f.checked)} · ${f.passed} of ${f.checked}`, warn: f.passed < f.checked * 0.9 }))} />
        </ChartCard>
      </Charts>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Farm
// ---------------------------------------------------------------------------
interface FarmData {
  actions: {
    to_answer: { po_id: string; po_number: string; delivery_date: string | null; stems: number }[]
    deliveries: { po_id: string; po_number: string; delivery_date: string; stems: number }[]
    returned: { box_id: number; qc_at: string; reasons: string[] }[]
  }
  tiles: { pos_waiting: number; stems_confirmed: number; deliveries_7_days: number; boxes_returned: number }
  stems_per_week: { week: string; stems: number }[]
  returns_by_reason: { reason: string; boxes: number }[]
}

export function FarmDashboard({ weeks }: { weeks: number }) {
  const q = useDashboard<FarmData>('farm', weeks)
  const notices = useFarmNotices()
  if (!q.data) return <Loading q={q} />
  const d = q.data
  const a = d.actions
  const groups: { title: string; empty: string; items: ActionItem[] }[] = [
    { title: 'Purchase orders to answer', empty: 'Nothing to answer.', items: a.to_answer.map((p) => ({ key: p.po_id, title: `${p.po_number} · ${compact(n(p.stems))} stems`, detail: `Deliver by ${formatDate(p.delivery_date)}`, urgent: true, to: '/farm/orders' })) },
    { title: 'Deliveries in the next 7 days', empty: 'No deliveries due.', items: a.deliveries.map((p) => ({ key: p.po_id, title: `${p.po_number} · ${formatDate(p.delivery_date)}`, detail: `${compact(n(p.stems))} stems`, to: '/farm/orders' })) },
    {
      title: 'Claim notices to answer',
      empty: 'No claims on your flowers.',
      items: (notices.data ?? [])
        .filter((x) => x.status === 'sent' || x.status === 'queried')
        .map((x) => ({ key: x.id, title: `${x.notice_number} · ${x.currency} ${x.amount.toFixed(2)}`, detail: 'Send your credit note', urgent: true, to: '/farm/claims' })),
    },
    { title: 'Boxes sent back to you (30 days)', empty: 'No boxes sent back.', items: a.returned.map((b) => ({ key: String(b.box_id), title: `Box ${b.box_id}`, detail: b.reasons.join(', '), to: '/farm/orders' })) },
  ]
  return (
    <div className="grid gap-4">
      <ActionsCard total={a.to_answer.length + a.deliveries.length}>
        {groups.map((g) => (
          <ActionGroup key={g.title} {...g} />
        ))}
      </ActionsCard>
      <Tiles>
        <StatTile label="POs to answer" value={String(d.tiles.pos_waiting)} tone={d.tiles.pos_waiting ? 'warn' : undefined} />
        <StatTile label="Stems confirmed in the period" value={compact(n(d.tiles.stems_confirmed))} />
        <StatTile label="Deliveries in 7 days" value={String(d.tiles.deliveries_7_days)} />
        <StatTile label="Boxes sent back in the period" value={String(d.tiles.boxes_returned)} />
      </Tiles>
      <Charts>
        <ChartCard title="Stems confirmed per week" table={{ columns: ['Week', 'Stems'], rows: d.stems_per_week.map((w) => [weekLabel(w.week), n(w.stems)]) }}>
          <ColumnChart ariaLabel="Stems confirmed per week" data={d.stems_per_week.map((w) => ({ label: weekLabel(w.week), values: { stems: n(w.stems) } }))} series={[{ key: 'stems', label: 'Stems', color: S1 }]} />
        </ChartCard>
        <ChartCard title="Why boxes were flagged" table={{ columns: ['Reason', 'Boxes'], rows: d.returns_by_reason.map((r) => [r.reason, r.boxes]) }} empty="No boxes flagged in this period.">
          <BarList rows={d.returns_by_reason.map((r) => ({ label: r.reason, value: r.boxes }))} />
        </ChartCard>
      </Charts>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------
interface BuyerData {
  currency: string
  is_prepaid: boolean
  actions: {
    waiting_approval: { order_id: string; order_number: string; ship_date: string | null }[]
    to_pay: { order_id: string; order_number: string; ship_date: string | null; value: number }[]
    upcoming: { order_id: string; order_number: string; ship_date: string; status: string; packing_list: boolean }[]
  }
  tiles: { open_orders: number; stems_in_period: number; spend_in_period: number; next_ship_date: string | null }
  stems_per_week: { week: string; stems: number }[]
  spend_per_month: { month: string; value: number }[]
}

export function BuyerDashboard({ weeks }: { weeks: number }) {
  const q = useDashboard<BuyerData>('buyer', weeks)
  if (!q.data) return <Loading q={q} />
  const d = q.data
  const cur = d.currency
  const a = d.actions
  const mine = (id: string) => ({ to: '/my-orders/$orderId', params: { orderId: id } })
  const groups: { title: string; empty: string; items: ActionItem[] }[] = [
    ...(d.is_prepaid
      ? [{ title: 'Orders to pay', empty: 'Nothing to pay.', items: a.to_pay.map((o) => ({ key: o.order_id, title: `${o.order_number} · ${money(n(o.value), cur)}`, detail: o.ship_date ? `Ships ${formatDate(o.ship_date)}: pay before it ships` : 'Pay before it ships', urgent: true, ...mine(o.order_id) })) }]
      : []),
    { title: 'Waiting for ConsolFlora to approve', empty: 'Nothing waiting.', items: a.waiting_approval.map((o) => ({ key: o.order_id, title: o.order_number, detail: o.ship_date ? `Ships ${formatDate(o.ship_date)}` : 'No ship date yet', ...mine(o.order_id) })) },
    { title: 'Coming shipments', empty: 'No orders on the way.', items: a.upcoming.map((o) => ({ key: o.order_id, title: `${o.order_number} · ${formatDate(o.ship_date)}`, detail: o.packing_list ? 'Packing list ready' : o.status === 'submitted' ? 'Waiting for approval' : 'Confirming with farms', ...mine(o.order_id) })) },
  ]
  return (
    <div className="grid gap-4">
      <ActionsCard total={(d.is_prepaid ? a.to_pay.length : 0) + a.waiting_approval.length}>
        {groups.map((g) => (
          <ActionGroup key={g.title} {...g} />
        ))}
      </ActionsCard>
      <Tiles>
        <StatTile label="Open orders" value={String(d.tiles.open_orders)} />
        <StatTile label="Stems ordered in the period" value={compact(n(d.tiles.stems_in_period))} />
        <StatTile label="Spend in the period" value={money(n(d.tiles.spend_in_period), cur)} />
        <StatTile label="Next shipment" value={d.tiles.next_ship_date ? formatDate(d.tiles.next_ship_date) : '—'} />
      </Tiles>
      <Charts>
        <ChartCard title="Stems ordered per week" table={{ columns: ['Week', 'Stems'], rows: d.stems_per_week.map((w) => [weekLabel(w.week), n(w.stems)]) }}>
          <ColumnChart ariaLabel="Stems ordered per week" data={d.stems_per_week.map((w) => ({ label: weekLabel(w.week), values: { stems: n(w.stems) } }))} series={[{ key: 'stems', label: 'Stems', color: S1 }]} />
        </ChartCard>
        <ChartCard title={`Spend per month (${cur})`} description="Flowers and other costs on your orders." table={{ columns: ['Month', `Spend (${cur})`], rows: d.spend_per_month.map((m) => [monthLabel(m.month), money(n(m.value), cur)]) }}>
          <ColumnChart ariaLabel={`Spend per month in ${cur}`} format={(v) => money(v, cur)} data={d.spend_per_month.map((m) => ({ label: monthLabel(m.month), values: { spend: n(m.value) } }))} series={[{ key: 'spend', label: 'Spend', color: S1 }]} />
        </ChartCard>
      </Charts>
    </div>
  )
}
