-- Dashboards per role (item 6). Each function returns one JSON document: "actions" (what needs doing,
-- most urgent first), "tiles" (key numbers) and chart series for the last p_weeks weeks. Each checks
-- the caller's role and only reads what that role may see. Money is never added across currencies.

create or replace function public.dash_from(p_weeks int)
returns date
language sql immutable
as $$
  select (date_trunc('week', (now() at time zone 'Africa/Nairobi')::date)::date - (greatest(least(p_weeks, 52), 1) - 1) * 7)
$$;

create or replace function public.dash_weeks(p_weeks int)
returns table (week date)
language sql stable
as $$
  select d::date from generate_series(public.dash_from(p_weeks), date_trunc('week', (now() at time zone 'Africa/Nairobi')::date), interval '7 days') d
$$;

-- Margin per stem on a farm PO line, in the order's currency.
create or replace function public.po_line_margin(p_po_line_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when l.quoted_price_per_stem is not null and pl.grower_price_per_stem is not null
              then l.quoted_price_per_stem - pl.grower_price_per_stem * public.fx(f.currency, o.currency, coalesce(po.delivery_date, current_date))
              else l.margin_per_stem end
  from purchase_order_lines pl
  join customer_order_lines l on l.id = pl.order_line_id
  join customer_orders o on o.id = l.order_id
  join purchase_orders po on po.id = pl.po_id
  join farms f on f.id = po.farm_id
  where pl.id = p_po_line_id
$$;

-- ---------------------------------------------------------------------------
-- Consolidator and Admin
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_staff(p_weeks int default 8)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_from date := public.dash_from(p_weeks);
begin
  if not public.is_staff() then
    raise exception 'This dashboard is for Admin and Consolidator users.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'actions', jsonb_build_object(
      'to_approve', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'buyer', c.company_name,
                       'ship_date', o.ship_date, 'created_at', o.created_at) order by o.created_at), '[]')
                     from customer_orders o join customers c on c.id = o.customer_id where o.status = 'submitted'),
      'short_lines', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'buyer', c.company_name,
                        'line_no', cov.line_no, 'product', p.variety || ' ' || p.stem_length_cm || ' cm', 'short', cov.short, 'ship_date', o.ship_date)
                        order by o.ship_date nulls last, o.order_number, cov.line_no), '[]')
                      from order_line_coverage cov join customer_orders o on o.id = cov.order_id join customers c on c.id = o.customer_id
                      join products p on p.id = cov.product_id
                      where o.status = 'open' and cov.short > 0 and coalesce(o.ship_date, current_date) >= current_date),
      'unanswered_pos', (select coalesce(jsonb_agg(jsonb_build_object('po_id', po.id, 'po_number', po.po_number, 'farm', f.farm_name,
                           'order_id', po.order_id, 'sent_at', po.sent_at, 'delivery_date', po.delivery_date) order by po.sent_at), '[]')
                         from purchase_orders po join farms f on f.id = po.farm_id
                         where po.status = 'sent' and po.sent_at < now() - interval '24 hours'),
      'ready_for_packing', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'buyer', c.company_name,
                              'ship_date', o.ship_date) order by o.ship_date nulls last), '[]')
                            from customer_orders o join customers c on c.id = o.customer_id
                            where o.status = 'open' and o.packing_list_at is null and coalesce(o.ship_date, current_date) >= current_date
                              and exists (select 1 from order_line_coverage x where x.order_id = o.id)
                              and not exists (select 1 from order_line_coverage x where x.order_id = o.id and x.confirmed < x.stems)),
      'flights_soon', (select coalesce(jsonb_agg(jsonb_build_object('shipment_id', s.id, 'shipment_ref', s.shipment_ref, 'flight_date', s.flight_date,
                         'blockers', b.blockers) order by s.flight_date), '[]')
                       from shipments s cross join lateral (select public.shipment_blockers(s.id) as blockers) b
                       where s.status = 'open' and s.flight_date between current_date and current_date + 3 and cardinality(b.blockers) > 0)
    ),
    'tiles', jsonb_build_object(
      'open_orders', (select count(*) from customer_orders where status in ('submitted', 'open') and coalesce(ship_date, current_date) >= current_date - 1),
      'stems_ordered', (select coalesce(sum(l.stems), 0) from customer_order_lines l join customer_orders o on o.id = l.order_id
                        where o.created_at >= v_from and o.status in ('submitted', 'open')),
      'pos_waiting', (select count(*) from purchase_orders where status = 'sent'),
      'boxes_waiting_qc', (select count(*) from boxes b join shipments s on s.id = b.shipment_id
                           where s.status = 'open' and b.status = 'active' and b.qc_status <> 'passed')
    ),
    'stems_per_week', (select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'stems', coalesce(x.stems, 0)) order by w.week), '[]')
                       from public.dash_weeks(p_weeks) w
                       left join (select date_trunc('week', o.created_at at time zone 'Africa/Nairobi')::date as week, sum(l.stems) as stems
                                  from customer_orders o join customer_order_lines l on l.order_id = o.id
                                  where o.status in ('submitted', 'open') group by 1) x on x.week = w.week),
    'fill_rate_by_farm', (select coalesce(jsonb_agg(jsonb_build_object('farm', farm_name, 'asked', asked, 'confirmed', confirmed) order by asked desc), '[]')
                          from (
                            select f.farm_name,
                                   coalesce(sum(pl.asked), 0) + coalesce(sum(lg.asked_zero), 0) as asked,
                                   coalesce(sum(pl.confirmed), 0) as confirmed
                            from purchase_orders po
                            join farms f on f.id = po.farm_id
                            left join lateral (select sum(coalesce(requested_stems, stems)) as asked, sum(stems) as confirmed
                                               from purchase_order_lines where po_id = po.id and po.status = 'confirmed') pl on true
                            left join lateral (select sum((e ->> 'asked')::int) as asked_zero
                                               from jsonb_array_elements(po.answer_log) a, jsonb_array_elements(a -> 'short') e
                                               where (e ->> 'confirmed')::int = 0) lg on true
                            where po.status in ('confirmed', 'declined') and po.responded_at >= v_from
                            group by f.farm_name
                          ) t where asked > 0),
    'margin_per_week', (select coalesce(jsonb_agg(jsonb_build_object('week', week, 'currency', currency, 'margin', round(margin, 2)) order by currency, week), '[]')
                        from (select w.week, cur.currency, coalesce(sum(m.margin), 0) as margin
                              from public.dash_weeks(p_weeks) w
                              cross join (select distinct currency from customer_orders where created_at >= v_from) cur
                              left join (select date_trunc('week', o.created_at at time zone 'Africa/Nairobi')::date as week, o.currency,
                                                pl.stems * public.po_line_margin(pl.id) as margin
                                         from purchase_order_lines pl join purchase_orders po on po.id = pl.po_id
                                         join customer_orders o on o.id = po.order_id
                                         where po.status = 'confirmed' and o.status = 'open') m on m.week = w.week and m.currency = cur.currency
                              group by w.week, cur.currency) t),
    'buyers', (select coalesce(jsonb_agg(b order by b ->> 'company_name'), '[]') from (
                 select jsonb_build_object('customer_id', c.id, 'company_name', c.company_name, 'customer_code', c.customer_code, 'currency', c.currency,
                   'orders', jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'status', o.status, 'ship_date', o.ship_date,
                     'stems', cv.stems, 'placed', cv.placed, 'confirmed', cv.confirmed, 'packing_list', o.packing_list_at is not null)
                     order by o.ship_date nulls last, o.order_number)) as b
                 from customer_orders o join customers c on c.id = o.customer_id
                 cross join lateral (select coalesce(sum(stems), 0) as stems, coalesce(sum(placed), 0) as placed, coalesce(sum(least(confirmed, stems)), 0) as confirmed
                                     from order_line_coverage where order_id = o.id) cv
                 where o.status in ('submitted', 'open') and coalesce(o.ship_date, current_date) >= current_date - 1
                 group by c.id) x)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_finance(p_weeks int default 8)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_from date := public.dash_from(p_weeks);
begin
  if not public.is_finance_or_admin() then
    raise exception 'This dashboard is for Finance and Admin users.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'actions', jsonb_build_object(
      'unpaid_prepaid', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'buyer', c.company_name,
                           'ship_date', o.ship_date, 'value', round(v.value, 2), 'currency', o.currency) order by o.ship_date), '[]')
                         from customer_orders o join customers c on c.id = o.customer_id join order_values v on v.order_id = o.id
                         where c.payment_terms = 'Prepaid' and o.status = 'open' and o.payment_status = 'unpaid' and o.ship_date <= current_date + 7),
      'over_limit', (select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_id, 'buyer', company_name, 'open_value', round(open_value, 2),
                       'credit_limit', credit_limit, 'currency', currency) order by company_name), '[]')
                     from buyer_credit where over_limit),
      'no_grower_price', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'farm', f.farm_name,
                            'product', p.variety || ' ' || p.stem_length_cm || ' cm') order by o.order_number), '[]')
                          from purchase_order_lines pl join purchase_orders po on po.id = pl.po_id join customer_orders o on o.id = po.order_id
                          join farms f on f.id = po.farm_id join products p on p.id = pl.product_id
                          where pl.grower_price_per_stem is null and o.status = 'open' and po.status <> 'cancelled'),
      -- Buyer currencies that farm prices can't be converted into: their catalog shows no prices.
      'missing_rates', (select coalesce(jsonb_agg(distinct jsonb_build_object('from', pl.currency, 'to', c.currency)), '[]')
                        from customers c cross join (select distinct currency from price_list) pl
                        where c.active and public.fx(pl.currency, c.currency) is null)
    ),
    'tiles', jsonb_build_object(
      'unpaid', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'value', round(value, 2))), '[]') from (
                   select v.currency, sum(v.value) as value from order_values v where v.status = 'open' and v.payment_status = 'unpaid' group by v.currency) t),
      'paid_in_period', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'value', round(value, 2))), '[]') from (
                   select o.currency, sum(v.value) as value from customer_orders o join order_values v on v.order_id = o.id
                   where o.payment_status = 'paid' and o.paid_at >= v_from group by o.currency) t),
      'buyers_over_limit', (select count(*) from buyer_credit where over_limit)
    ),
    'credit', (select coalesce(jsonb_agg(jsonb_build_object('buyer', company_name, 'currency', currency, 'open_value', round(open_value, 2),
                 'credit_limit', credit_limit) order by open_value desc), '[]')
               from buyer_credit where not is_prepaid and credit_limit is not null),
    'paid_unpaid_per_week', (select coalesce(jsonb_agg(jsonb_build_object('week', week, 'currency', currency, 'paid', round(paid, 2), 'unpaid', round(unpaid, 2))
                               order by currency, week), '[]')
                             from (select w.week, cur.currency,
                                          coalesce(sum(v.value) filter (where v.payment_status = 'paid'), 0) as paid,
                                          coalesce(sum(v.value) filter (where v.payment_status = 'unpaid'), 0) as unpaid
                                   from public.dash_weeks(p_weeks) w
                                   cross join (select distinct currency from customer_orders where created_at >= v_from) cur
                                   left join (select date_trunc('week', o.created_at at time zone 'Africa/Nairobi')::date as week, o.currency, o.payment_status, v.value
                                              from customer_orders o join order_values v on v.order_id = o.id where o.status = 'open') v
                                     on v.week = w.week and v.currency = cur.currency
                                   group by w.week, cur.currency) t),
    'margin_by_incoterm', (select coalesce(jsonb_agg(jsonb_build_object('incoterm', incoterm, 'currency', currency, 'margin', round(margin, 2)) order by currency, incoterm), '[]')
                           from (select o.incoterm, o.currency, sum(pl.stems * public.po_line_margin(pl.id)) as margin
                                 from purchase_order_lines pl join purchase_orders po on po.id = pl.po_id join customer_orders o on o.id = po.order_id
                                 where po.status = 'confirmed' and o.status = 'open' and o.created_at >= v_from
                                 group by o.incoterm, o.currency) t)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- QC and Senior QC
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_qc(p_weeks int default 8)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_from date := public.dash_from(p_weeks);
begin
  if not public.is_qc() then
    raise exception 'This dashboard is for QC users.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'actions', jsonb_build_object(
      'waiting_by_shipment', (select coalesce(jsonb_agg(jsonb_build_object('shipment_id', s.id, 'shipment_ref', s.shipment_ref, 'flight_date', s.flight_date,
                                'not_received', t.not_received, 'not_checked', t.not_checked) order by s.flight_date nulls last), '[]')
                              from shipments s cross join lateral (
                                select count(*) filter (where b.received_at is null) as not_received,
                                       count(*) filter (where b.received_at is not null and b.qc_status = 'pending') as not_checked
                                from boxes b where b.shipment_id = s.id and b.status = 'active') t
                              where s.status = 'open' and (t.not_received + t.not_checked) > 0),
      'major_to_clear', (select coalesce(jsonb_agg(jsonb_build_object('box_id', b.id, 'shipment_id', b.shipment_id, 'shipment_ref', s.shipment_ref,
                           'farm', f.farm_name, 'reasons', b.qc_reasons, 'qc_at', b.qc_at) order by b.qc_at), '[]')
                         from boxes b join shipments s on s.id = b.shipment_id join farms f on f.id = b.farm_id
                         where b.status = 'active' and b.qc_status = 'failed' and s.status = 'open'),
      'stickers_to_print', (select coalesce(jsonb_agg(jsonb_build_object('box_id', b.id, 'shipment_id', b.shipment_id, 'shipment_ref', s.shipment_ref,
                              'farm', f.farm_name) order by b.qc_at), '[]')
                            from boxes b join shipments s on s.id = b.shipment_id join farms f on f.id = b.farm_id
                            where b.status = 'back_to_farm' and not exists (select 1 from back_to_farm_stickers k where k.box_id = b.id))
    ),
    'tiles', jsonb_build_object(
      'checked', (select count(*) from boxes where qc_at >= v_from and qc_status <> 'pending'),
      'passed', (select count(*) from boxes where qc_at >= v_from and qc_status = 'passed'),
      'back_to_farm', (select count(*) from boxes where qc_at >= v_from and status = 'back_to_farm'),
      'major_open', (select count(*) from boxes b join shipments s on s.id = b.shipment_id where b.status = 'active' and b.qc_status = 'failed' and s.status = 'open')
    ),
    'reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', label, 'boxes', n) order by n desc, label), '[]')
                from (select q.label, count(distinct e.box_id) as n
                      from qc_events e cross join unnest(e.reasons) r join qc_reasons q on q.code = r
                      where e.kind = 'result' and e.result in ('minor', 'major', 'critical') and e.happened_at >= v_from
                      group by q.label) t),
    'pass_rate_by_farm', (select coalesce(jsonb_agg(jsonb_build_object('farm', farm_name, 'checked', checked, 'passed', passed) order by checked desc), '[]')
                          from (select f.farm_name, count(*) as checked, count(*) filter (where b.qc_status = 'passed') as passed
                                from boxes b join farms f on f.id = b.farm_id
                                where b.qc_at >= v_from and b.qc_status <> 'pending'
                                group by f.farm_name) t)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Farm (their own POs only)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_farm(p_weeks int default 8)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_from date := public.dash_from(p_weeks);
  v_farm uuid := public.my_farm_id();
begin
  if not public.has_role('farm') or v_farm is null then
    raise exception 'This dashboard is for farm users.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'actions', jsonb_build_object(
      'to_answer', (select coalesce(jsonb_agg(jsonb_build_object('po_id', po.id, 'po_number', po.po_number, 'delivery_date', po.delivery_date,
                      'stems', (select sum(stems) from purchase_order_lines where po_id = po.id)) order by po.delivery_date nulls last), '[]')
                    from purchase_orders po where po.farm_id = v_farm and po.status = 'sent'),
      'deliveries', (select coalesce(jsonb_agg(jsonb_build_object('po_id', po.id, 'po_number', po.po_number, 'delivery_date', po.delivery_date,
                       'stems', (select sum(stems) from purchase_order_lines where po_id = po.id)) order by po.delivery_date), '[]')
                     from purchase_orders po where po.farm_id = v_farm and po.status = 'confirmed' and po.delivery_date between current_date and current_date + 7),
      'returned', (select coalesce(jsonb_agg(jsonb_build_object('box_id', b.id, 'qc_at', b.qc_at, 'reasons',
                     (select coalesce(jsonb_agg(q.label order by q.sort_order), '[]') from qc_reasons q where q.code = any (b.qc_reasons)))
                     order by b.qc_at desc), '[]')
                   from boxes b where b.farm_id = v_farm and b.status = 'back_to_farm' and b.qc_at >= current_date - 30)
    ),
    'tiles', jsonb_build_object(
      'pos_waiting', (select count(*) from purchase_orders where farm_id = v_farm and status = 'sent'),
      'stems_confirmed', (select coalesce(sum(pl.stems), 0) from purchase_order_lines pl join purchase_orders po on po.id = pl.po_id
                          where po.farm_id = v_farm and po.status = 'confirmed' and po.responded_at >= v_from),
      'deliveries_7_days', (select count(*) from purchase_orders where farm_id = v_farm and status = 'confirmed' and delivery_date between current_date and current_date + 7),
      'boxes_returned', (select count(*) from boxes where farm_id = v_farm and status = 'back_to_farm' and qc_at >= v_from)
    ),
    'stems_per_week', (select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'stems', coalesce(x.stems, 0)) order by w.week), '[]')
                       from public.dash_weeks(p_weeks) w
                       left join (select date_trunc('week', po.responded_at at time zone 'Africa/Nairobi')::date as week, sum(pl.stems) as stems
                                  from purchase_orders po join purchase_order_lines pl on pl.po_id = po.id
                                  where po.farm_id = v_farm and po.status = 'confirmed' group by 1) x on x.week = w.week),
    'returns_by_reason', (select coalesce(jsonb_agg(jsonb_build_object('reason', label, 'boxes', n) order by n desc, label), '[]')
                          from (select q.label, count(*) as n from boxes b cross join unnest(b.qc_reasons) r join qc_reasons q on q.code = r
                                where b.farm_id = v_farm and b.qc_at >= v_from and b.qc_severity in ('minor', 'major', 'critical')
                                group by q.label) t)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Buyer (their own orders only, in their currency)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_buyer(p_weeks int default 8)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_from date := public.dash_from(p_weeks);
  v_customer customers%rowtype;
begin
  select * into v_customer from customers where id = public.my_customer_id();
  if not public.has_role('customer') or not found then
    raise exception 'This dashboard is for buyers.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'currency', v_customer.currency,
    'is_prepaid', v_customer.payment_terms = 'Prepaid',
    'actions', jsonb_build_object(
      'waiting_approval', (select coalesce(jsonb_agg(jsonb_build_object('order_id', id, 'order_number', order_number, 'ship_date', ship_date) order by created_at), '[]')
                           from customer_orders where customer_id = v_customer.id and status = 'submitted'),
      'to_pay', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'ship_date', o.ship_date, 'value', round(v.value, 2))
                   order by o.ship_date), '[]')
                 from customer_orders o join order_values v on v.order_id = o.id
                 where o.customer_id = v_customer.id and o.status = 'open' and o.payment_status = 'unpaid' and v_customer.payment_terms = 'Prepaid'),
      'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'ship_date', o.ship_date,
                     'status', o.status, 'packing_list', o.packing_list_at is not null) order by o.ship_date), '[]')
                   from customer_orders o where o.customer_id = v_customer.id and o.status in ('submitted', 'open') and o.ship_date >= current_date)
    ),
    'tiles', jsonb_build_object(
      'open_orders', (select count(*) from customer_orders where customer_id = v_customer.id and status in ('submitted', 'open') and coalesce(ship_date, current_date) >= current_date),
      'stems_in_period', (select coalesce(sum(l.stems), 0) from customer_order_lines l join customer_orders o on o.id = l.order_id
                          where o.customer_id = v_customer.id and o.status in ('submitted', 'open') and o.created_at >= v_from),
      'spend_in_period', (select round(coalesce(sum(v.value), 0), 2) from order_values v join customer_orders o on o.id = v.order_id
                          where o.customer_id = v_customer.id and o.status in ('submitted', 'open') and o.created_at >= v_from),
      'next_ship_date', (select min(ship_date) from customer_orders where customer_id = v_customer.id and status in ('submitted', 'open') and ship_date >= current_date)
    ),
    'stems_per_week', (select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'stems', coalesce(x.stems, 0)) order by w.week), '[]')
                       from public.dash_weeks(p_weeks) w
                       left join (select date_trunc('week', o.created_at at time zone 'Africa/Nairobi')::date as week, sum(l.stems) as stems
                                  from customer_orders o join customer_order_lines l on l.order_id = o.id
                                  where o.customer_id = v_customer.id and o.status in ('submitted', 'open') group by 1) x on x.week = w.week),
    'spend_per_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'value', round(coalesce(x.value, 0), 2)) order by m.month), '[]')
                        from (select d::date as month from generate_series(date_trunc('month', v_from), date_trunc('month', current_date), interval '1 month') d) m
                        left join (select date_trunc('month', o.created_at at time zone 'Africa/Nairobi')::date as month, sum(v.value) as value
                                   from customer_orders o join order_values v on v.order_id = o.id
                                   where o.customer_id = v_customer.id and o.status in ('submitted', 'open') group by 1) x on x.month = m.month)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Email settings: a place for the Zoho details until email is switched on (last item).
-- Passwords are never stored here; they go into the server environment.
-- ---------------------------------------------------------------------------
create table public.mail_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  from_name text default 'ConsolFlora',
  from_address text,
  smtp_host text,
  smtp_port int check (smtp_port between 1 and 65535),
  smtp_user text,
  imap_host text,
  imap_port int check (imap_port between 1 and 65535),
  imap_user text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
insert into public.mail_settings (smtp_host, smtp_port, imap_host, imap_port) values ('smtp.zoho.com', 465, 'imap.zoho.com', 993);
alter table public.mail_settings enable row level security;
create policy "mail_settings: admin read" on public.mail_settings for select to authenticated using (public.has_role('admin'));
create policy "mail_settings: admin update" on public.mail_settings for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
revoke insert, delete on public.mail_settings from authenticated, anon;
create trigger mail_settings_touch before update on public.mail_settings for each row execute function public.touch_updated();

revoke execute on function public.po_line_margin(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['dashboard_staff(int)', 'dashboard_finance(int)', 'dashboard_qc(int)', 'dashboard_farm(int)', 'dashboard_buyer(int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
