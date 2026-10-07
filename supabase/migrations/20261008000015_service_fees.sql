-- Service fees (ConsolFlora's rate card).
-- Each buyer takes one service. The service decides which fees apply:
--   Sourcing                  the per-stem fee
--   Consolidation             a document consolidation fee per shipment (80)
--   Intake and quality checks a fee per shipment (150)
--   Full package              the per-stem fee plus a document consolidation fee per shipment (100)
-- The per-stem fee is per incoterm and stem length (margin_rules). On FOB: 0.01 for 40/50 cm, 0.02 for
-- 60/70 cm, 0.025 for 80 to 120 cm. Fees are the same figure in euros or US dollars: a rule or fee with no
-- currency is not converted. Orders already placed keep their prices; per-shipment fees are added from now on.

alter table public.customers add column service text not null default 'full_package'
  check (service in ('sourcing', 'consolidation', 'intake_qc', 'full_package'));

create table public.service_fees (
  service text primary key check (service in ('sourcing', 'consolidation', 'intake_qc', 'full_package')),
  label text not null,
  per_stem boolean not null, -- the per-stem fee (margin_rules) applies
  fee_per_shipment numeric(12, 2) not null default 0 check (fee_per_shipment >= 0),
  fee_description text, -- how the per-shipment fee shows on the proforma
  currency text check (currency ~ '^[A-Z]{3}$'), -- null: the same figure in every currency
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
insert into public.service_fees (service, label, per_stem, fee_per_shipment, fee_description) values
  ('sourcing', 'Sourcing', true, 0, null),
  ('consolidation', 'Consolidation', false, 80, 'Document consolidation fee'),
  ('intake_qc', 'Intake and quality checks', false, 150, 'Intake and quality checks'),
  ('full_package', 'Full package', true, 100, 'Document consolidation fee');
alter table public.service_fees enable row level security;
create policy "service_fees: staff read" on public.service_fees for select to authenticated using (public.is_staff() or public.is_finance_or_admin());
create policy "service_fees: admin and finance change" on public.service_fees for update to authenticated
  using (public.is_finance_or_admin()) with check (public.is_finance_or_admin());
create trigger service_fees_touch before update on public.service_fees for each row execute function public.touch_updated();

-- Margin rules with no currency are the same figure in every currency (the rate card's € or US$).
alter table public.margin_rules alter column currency drop not null, alter column currency drop default;
-- The FOB rate card.
update public.margin_rules set margin_per_stem = 0.010, currency = null
where incoterm = 'FOB' and flower_type is null and min_length_cm = 0 and max_length_cm = 50;
update public.margin_rules set max_length_cm = 79, margin_per_stem = 0.020, currency = null
where incoterm = 'FOB' and flower_type is null and min_length_cm = 51 and max_length_cm is null;
insert into public.margin_rules (incoterm, min_length_cm, max_length_cm, margin_per_stem, currency)
select 'FOB', 80, null, 0.025, null
where not exists (select 1 from public.margin_rules where incoterm = 'FOB' and flower_type is null and min_length_cm = 80);

create or replace function public.margin_in(p_incoterm text, p_product_id uuid, p_currency text, p_on date default current_date)
returns numeric
language sql stable security definer set search_path = public
as $$
  select r.margin_per_stem * case when r.currency is null then 1 else public.fx(r.currency, p_currency, p_on) end
  from margin_rules r
  join products p on p.id = p_product_id
  where r.active
    and r.incoterm = p_incoterm
    and p.stem_length_cm >= r.min_length_cm
    and (r.max_length_cm is null or p.stem_length_cm <= r.max_length_cm)
    and (r.flower_type is null or lower(r.flower_type) = lower(p.flower_type))
  order by (r.flower_type is not null) desc, (r.currency is not distinct from p_currency) desc, coalesce(r.max_length_cm, 100000) - r.min_length_cm
  limit 1
$$;

-- The per-stem fee for a buyer's service: the incoterm margin, or nothing for per-shipment services.
create or replace function public.service_margin(p_incoterm text, p_service text, p_product_id uuid, p_currency text, p_on date default current_date)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when coalesce((select per_stem from service_fees where service = p_service), true)
              then public.margin_in(p_incoterm, p_product_id, p_currency, p_on) else 0 end
$$;

-- The buyer's price per stem for their service (see sell_price_in for the rules).
create or replace function public.sell_price_for(p_incoterm text, p_service text, p_product_id uuid, p_on date, p_currency text)
returns table (price numeric, farm_id uuid, source text)
language sql stable security definer set search_path = public
as $$
  with o as (
    select * from price_overrides where product_id = p_product_id and incoterm = p_incoterm
    order by (currency = p_currency) desc limit 1
  ),
  cheapest as (
    select f.id, public.farm_price_in(f.id, p_product_id, p_on, p_currency) as cost
    from farms f where f.active and public.farm_price_in(f.id, p_product_id, p_on, p_currency) is not null
    order by 2, f.farm_name limit 1
  ),
  m as (select public.service_margin(p_incoterm, p_service, p_product_id, p_currency, p_on) as margin)
  select
    case
      when (select sell_price_per_stem from o where currency = p_currency) is not null then (select sell_price_per_stem from o where currency = p_currency)
      when (select pinned_farm_id from o) is not null
        then public.farm_price_in((select pinned_farm_id from o), p_product_id, p_on, p_currency) + coalesce((select margin from m), 0)
      else (select cost from cheapest) + coalesce((select margin from m), 0)
    end,
    coalesce((select pinned_farm_id from o), (select id from cheapest)),
    case when (select sell_price_per_stem from o where currency = p_currency) is not null then 'fixed'
         when (select pinned_farm_id from o) is not null then 'pinned_farm'
         else 'cheapest_farm' end
$$;
revoke execute on function public.service_margin(text, text, uuid, text, date), public.sell_price_for(text, text, uuid, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-shipment fees: one charge per buyer per shipment, on their earliest active order.
-- ---------------------------------------------------------------------------
alter table public.order_charges add column kind text not null default 'manual' check (kind in ('manual', 'service_fee'));

create or replace function public.sync_service_fee(p_customer_id uuid, p_shipment_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_fee service_fees%rowtype;
  v_keep uuid;
begin
  if p_customer_id is null or p_shipment_id is null then return; end if;
  if exists (select 1 from shipments where id = p_shipment_id and status = 'closed') then return; end if;
  select f.* into v_fee from service_fees f join customers c on c.service = f.service where c.id = p_customer_id;
  -- The order that carries the fee: the earliest active one.
  select o.id into v_keep from customer_orders o
  where o.customer_id = p_customer_id and o.shipment_id = p_shipment_id and o.status in ('submitted', 'open')
  order by o.created_at, o.order_number limit 1;
  delete from order_charges c using customer_orders o
  where c.order_id = o.id and c.kind = 'service_fee' and o.customer_id = p_customer_id and o.shipment_id = p_shipment_id
    and (v_keep is null or c.order_id <> v_keep or coalesce(v_fee.fee_per_shipment, 0) = 0);
  if v_keep is not null and coalesce(v_fee.fee_per_shipment, 0) > 0
     and not exists (select 1 from order_charges where order_id = v_keep and kind = 'service_fee') then
    insert into order_charges (order_id, description, amount, sort_order, kind)
    select v_keep, v_fee.fee_description || ' (per shipment)',
           round(v_fee.fee_per_shipment * case when v_fee.currency is null then 1 else public.fx(v_fee.currency, o.currency, current_date) end, 2),
           0, 'service_fee'
    from customer_orders o where o.id = v_keep;
  end if;
end;
$$;
revoke execute on function public.sync_service_fee(uuid, uuid) from public, anon, authenticated;

create or replace function public.customer_orders_service_fee()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.sync_service_fee(new.customer_id, new.shipment_id);
  if tg_op = 'UPDATE' and (old.shipment_id is distinct from new.shipment_id or old.customer_id is distinct from new.customer_id) then
    perform public.sync_service_fee(old.customer_id, old.shipment_id);
  end if;
  return null;
end;
$$;
create trigger customer_orders_service_fee after insert or update of status, shipment_id, customer_id on public.customer_orders
  for each row execute function public.customer_orders_service_fee();

-- The signed-in buyer's service and fees (shown in the catalog and at checkout).
create or replace function public.my_service()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('service', f.service, 'label', f.label, 'per_stem', f.per_stem,
                            'fee_per_shipment', f.fee_per_shipment, 'fee_description', f.fee_description, 'currency', c.currency)
  from customers c join service_fees f on f.service = c.service
  where c.id = public.my_customer_id()
$$;

-- ---------------------------------------------------------------------------
-- Item 5/6 functions, now with the buyer's service (generated from their current definitions).
-- ---------------------------------------------------------------------------

create or replace function public.catalog(p_customer_id uuid default null)
returns table (
  product_id uuid, product_code text, flower_type text, variety text, colour text, grade text,
  stem_length_cm int, head_size_cm numeric, maturity text, stems_per_bunch int,
  price_per_stem numeric, currency text, farms int
)
language plpgsql stable security definer set search_path = public
as $$
declare v_customer customers%rowtype;
begin
  select * into v_customer from customers
  where id = coalesce(p_customer_id, public.my_customer_id())
    and (id = public.my_customer_id() or public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]));
  if not found then
    raise exception 'The catalog is for buyers. Staff: choose the buyer to see their prices.';
  end if;
  return query
  select p.id, p.product_code, p.flower_type, p.variety, p.colour, p.grade, p.stem_length_cm, p.head_size_cm, p.maturity,
         p.stems_per_bunch, round(sp.price, 4), v_customer.currency,
         (select count(*)::int from farms f where f.active and public.farm_price_in(f.id, p.id, current_date, v_customer.currency) is not null)
  from products p
  cross join lateral public.sell_price_for(v_customer.incoterm, v_customer.service, p.id, current_date, v_customer.currency) sp
  where p.active and sp.price is not null
  order by p.flower_type, p.variety, p.stem_length_cm;
end;
$$;

create or replace function public.place_order(p_shipment_id uuid, p_ship_date date, p_lines jsonb, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_customer customers%rowtype;
  v_ship date := p_ship_date;
  v_flight shipments%rowtype;
  v_number text;
  v_order uuid;
  v_new_buyer boolean;
  v_unpriced text;
begin
  if not public.has_role('customer') or public.my_customer_id() is null then
    raise exception 'Only buyer accounts can place orders here.' using errcode = '42501';
  end if;
  select * into v_customer from customers where id = public.my_customer_id();
  if not v_customer.active then raise exception 'This buyer account is inactive. Contact ConsolFlora.'; end if;
  if p_shipment_id is not null then
    select * into v_flight from shipments where id = p_shipment_id and status = 'open';
    if not found then raise exception 'That flight is no longer open. Choose another.'; end if;
    v_ship := v_flight.flight_date;
  end if;
  if v_ship is null then raise exception 'Choose a flight or a ship date.'; end if;
  if v_ship < public.earliest_ship_date() then
    raise exception 'Orders need % hours before the ship date. The earliest ship date now is %.',
      (select min_lead_hours from ordering_settings), to_char(public.earliest_ship_date(), 'FMDay DD Mon YYYY');
  end if;
  perform public.check_order_lines(p_lines);
  select string_agg(p.product_code, ', ') into v_unpriced
  from jsonb_array_elements(p_lines) l join products p on p.id = (l ->> 'product_id')::uuid
  where (select price from public.sell_price_for(v_customer.incoterm, v_customer.service, p.id, current_date, v_customer.currency)) is null;
  if v_unpriced is not null then raise exception 'No price yet for %. Remove it or ask ConsolFlora.', v_unpriced; end if;

  v_new_buyer := not exists (select 1 from customer_orders where customer_id = v_customer.id and status = 'open' and approved_at is not null);
  v_number := public.next_order_number(v_customer.id);
  insert into customer_orders (order_number, customer_id, shipment_id, ship_date, incoterm, currency, status, source, notes, flight_note)
  values (v_number, v_customer.id, p_shipment_id, v_ship, v_customer.incoterm, v_customer.currency, 'submitted', 'self_order',
          nullif(btrim(coalesce(p_notes, '')), ''),
          case when v_new_buyer then 'New buyer: ConsolFlora confirms the flight and may move the order to a better one.' end)
  returning id into v_order;
  insert into customer_order_lines (order_id, line_no, product_id, stems, margin_per_stem, notes, bunching, stems_per_bunch, sleeves, bunch_labels, quoted_price_per_stem)
  select v_order, l.ord, (l.line ->> 'product_id')::uuid, (l.line ->> 'stems')::int,
         public.service_margin(v_customer.incoterm, v_customer.service, (l.line ->> 'product_id')::uuid, v_customer.currency), nullif(btrim(l.line ->> 'notes'), ''),
         coalesce(l.line ->> 'bunching', 'standard'), (l.line ->> 'stems_per_bunch')::int,
         (l.line ->> 'sleeves')::boolean, (l.line ->> 'bunch_labels')::boolean,
         (select price from public.sell_price_for(v_customer.incoterm, v_customer.service, (l.line ->> 'product_id')::uuid, current_date, v_customer.currency))
  from jsonb_array_elements(p_lines) with ordinality as l (line, ord);
  perform public.notify('staff', 'order_submitted', format('New order %s from %s', v_number, v_customer.company_name), null, v_order);
  return jsonb_build_object('order_id', v_order, 'order_number', v_number, 'ship_date', v_ship);
end;
$$;

create or replace function public.line_farm_options(p_order_line_id uuid)
returns table (
  farm_id uuid, farm_code text, farm_name text, cost_per_stem numeric, sell_per_stem numeric, margin_per_stem numeric,
  placed_stems int, recommended boolean, pinned boolean
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_line customer_order_lines%rowtype;
  v_order customer_orders%rowtype;
  v_on date;
  v_pinned uuid;
  v_sell numeric;
begin
  if not public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) then
    raise exception 'Only ConsolFlora staff can see farm costs.' using errcode = '42501';
  end if;
  select * into v_line from customer_order_lines where id = p_order_line_id;
  if not found then raise exception 'This order line doesn''t exist.'; end if;
  select * into v_order from customer_orders where id = v_line.order_id;
  v_on := coalesce(v_order.farm_delivery_date, current_date);
  select pinned_farm_id into v_pinned from price_overrides where product_id = v_line.product_id and incoterm = v_order.incoterm
  order by (currency = v_order.currency) desc limit 1;
  v_sell := coalesce(v_line.quoted_price_per_stem, (select price from public.sell_price_for(v_order.incoterm, (select service from customers where id = v_order.customer_id), v_line.product_id, v_on, v_order.currency)));
  return query
  with options as (
    select f.id, f.farm_code, f.farm_name, public.farm_price_in(f.id, v_line.product_id, v_on, v_order.currency) as cost
    from farms f where f.active
  )
  select o.id, o.farm_code, o.farm_name, o.cost, round(v_sell, 4), round(v_sell - o.cost, 4),
         coalesce((select sum(pl.stems)::int from purchase_order_lines pl join purchase_orders po on po.id = pl.po_id
                   where pl.order_line_id = v_line.id and po.farm_id = o.id), 0),
         o.id = coalesce(v_pinned, (select x.id from options x where x.cost is not null order by x.cost, x.farm_name limit 1)),
         o.id = v_pinned
  from options o
  where o.cost is not null
  order by o.cost, o.farm_name;
end;
$$;

create or replace function public.generate_standing_orders(p_today date default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Africa/Nairobi')::date);
  v_ahead int := (select standing_order_days_ahead from ordering_settings);
  v_so record;
  v_day date;
  v_customer customers%rowtype;
  v_order uuid;
  v_number text;
  v_count int := 0;
  v_flight uuid;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Only ConsolFlora staff can run this.' using errcode = '42501';
  end if;
  for v_so in select * from standing_orders where active loop
    select * into v_customer from customers where id = v_so.customer_id;
    continue when not v_customer.active;
    for v_day in select d::date from generate_series(v_today + 1, v_today + v_ahead, interval '1 day') d loop
      continue when extract(isodow from v_day)::int <> all (v_so.weekdays);
      continue when v_day < v_so.starts_on or (v_so.ends_on is not null and v_day > v_so.ends_on);
      continue when exists (select 1 from standing_order_skips where standing_order_id = v_so.id and ship_date = v_day);
      continue when exists (select 1 from customer_orders where standing_order_id = v_so.id and standing_date = v_day);
      select s.id into v_flight from shipments s
      where s.status = 'open' and s.flight_date = v_day and coalesce(s.destination_airport, v_customer.destination_airport) = v_customer.destination_airport
      order by s.shipment_ref limit 1;
      v_number := public.next_order_number(v_customer.id);
      insert into customer_orders (order_number, customer_id, shipment_id, ship_date, incoterm, currency, status, source, notes,
                                   approved_at, standing_order_id, standing_date)
      values (v_number, v_customer.id, v_flight, v_day, v_customer.incoterm, v_customer.currency, 'open', 'self_order',
              'Standing order', now(), v_so.id, v_day)
      returning id into v_order;
      insert into customer_order_lines (order_id, line_no, product_id, stems, margin_per_stem, notes, bunching, stems_per_bunch, sleeves, bunch_labels, quoted_price_per_stem)
      select v_order, l.line_no, l.product_id, l.stems, public.service_margin(v_customer.incoterm, v_customer.service, l.product_id, v_customer.currency, v_day), l.notes, l.bunching, l.stems_per_bunch,
             l.sleeves, l.bunch_labels, (select price from public.sell_price_for(v_customer.incoterm, v_customer.service, l.product_id, v_day, v_customer.currency))
      from standing_order_lines l where l.standing_order_id = v_so.id;
      perform public.notify('staff', 'standing_order_due', format('Standing order %s for %s ships %s: place it with farms', v_number,
        v_customer.company_name, to_char(v_day, 'FMDay DD Mon')), null, v_order);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- Orders entered by staff, and changing an order's incoterm, also follow the buyer's service.
create or replace function public.create_customer_order(
  p_customer_id uuid,
  p_shipment_id uuid,
  p_farm_delivery_date date,
  p_lines jsonb,
  p_notes text default null,
  p_incoterm text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_customer customers%rowtype;
  v_no int;
  v_order_id uuid;
  v_number text;
  v_incoterm text;
  v_bad text;
begin
  perform public.require_staff();
  select * into v_customer from customers where id = p_customer_id;
  if not found or not v_customer.active then
    raise exception 'This buyer doesn''t exist or is inactive.';
  end if;
  if p_shipment_id is not null and not exists (select 1 from shipments where id = p_shipment_id and status = 'open') then
    raise exception 'That shipment is closed. Choose an open shipment.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one line.';
  end if;
  select coalesce((
    select 'Line ' || l.ord || ': ' || case
      when p.id is null then 'the product doesn''t exist.'
      when not p.active then 'product ' || p.product_code || ' is inactive.'
      else 'stems must be a whole number above 0.' end
    from jsonb_array_elements(p_lines) with ordinality as l (line, ord)
    left join products p on p.id = (l.line ->> 'product_id')::uuid
    where p.id is null or not p.active or coalesce((l.line ->> 'stems')::numeric, 0) <= 0
      or (l.line ->> 'stems')::numeric <> trunc((l.line ->> 'stems')::numeric)
    order by l.ord limit 1), null) into v_bad;
  if v_bad is not null then
    raise exception '%', v_bad;
  end if;

  v_incoterm := coalesce(nullif(btrim(p_incoterm), ''), v_customer.incoterm);
  insert into customer_order_counters (customer_id, last_no) values (p_customer_id, 1)
  on conflict (customer_id) do update set last_no = customer_order_counters.last_no + 1
  returning last_no into v_no;
  v_number := 'CFL' || v_customer.customer_code || lpad(v_no::text, 4, '0');

  insert into customer_orders (order_number, customer_id, shipment_id, incoterm, currency, farm_delivery_date, notes)
  values (v_number, p_customer_id, p_shipment_id, v_incoterm, v_customer.currency, p_farm_delivery_date, nullif(btrim(p_notes), ''))
  returning id into v_order_id;

  insert into customer_order_lines (order_id, line_no, product_id, stems, margin_per_stem, notes)
  select v_order_id, l.ord, (l.line ->> 'product_id')::uuid, (l.line ->> 'stems')::int,
         public.service_margin(v_incoterm, v_customer.service, (l.line ->> 'product_id')::uuid, v_customer.currency), nullif(btrim(l.line ->> 'notes'), '')
  from jsonb_array_elements(p_lines) with ordinality as l (line, ord);

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_number);
end;
$$;

create or replace function public.customer_orders_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.shipment_id is distinct from old.shipment_id then
    if exists (select 1 from public.boxes b where b.customer_id = old.customer_id and b.shipment_id = old.shipment_id and b.status = 'active'
               and exists (select 1 from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.po_id
                           where pl.id = b.po_line_id and po.order_id = old.id)) then
      raise exception 'Order % already has boxes in its shipment. Void them before moving the order.', old.order_number;
    end if;
    if new.shipment_id is not null and exists (select 1 from public.shipments where id = new.shipment_id and status = 'closed') then
      raise exception 'That shipment is closed. Choose an open shipment.';
    end if;
  end if;
  if new.incoterm is distinct from old.incoterm then
    update public.customer_order_lines l set margin_per_stem = public.service_margin(new.incoterm, (select service from public.customers where id = new.customer_id), l.product_id, new.currency) where l.order_id = new.id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboards: per-shipment service fees count towards ConsolFlora's margin.
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
      'products_to_review', (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'product_code', p.product_code,
                               'product', p.variety || ' ' || p.stem_length_cm || ' cm', 'reasons', t.reasons) order by p.product_code), '[]')
                             from (select product_id, jsonb_agg(detail order by created_at) as reasons from product_reviews
                                   where resolved_at is null group by product_id) t join products p on p.id = t.product_id),
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
                                         where po.status = 'confirmed' and o.status = 'open'
                                         union all
                                         select date_trunc('week', o.created_at at time zone 'Africa/Nairobi')::date, o.currency, c.amount
                                         from order_charges c join customer_orders o on o.id = c.order_id
                                         where c.kind = 'service_fee' and o.status = 'open') m on m.week = w.week and m.currency = cur.currency
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
                           from (select incoterm, currency, sum(margin) as margin from (
                                   select o.incoterm, o.currency, pl.stems * public.po_line_margin(pl.id) as margin
                                   from purchase_order_lines pl join purchase_orders po on po.id = pl.po_id join customer_orders o on o.id = po.order_id
                                   where po.status = 'confirmed' and o.status = 'open' and o.created_at >= v_from
                                   union all
                                   select o.incoterm, o.currency, c.amount
                                   from order_charges c join customer_orders o on o.id = c.order_id
                                   where c.kind = 'service_fee' and o.status = 'open' and o.created_at >= v_from) x
                                 group by incoterm, currency) t)
  );
end;
$$;
