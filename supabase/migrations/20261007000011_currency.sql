-- Every buyer sees and pays in their own currency (item 6).
--
-- Farm prices are in the farm price list's currency and margin rules in their own currency (USD by
-- default). Exchange rates, kept by Finance or Admin, convert both into the buyer's currency for the
-- catalog, quotes, the cost calculator, proformas and order values. If a rate is missing, the
-- product has no price for that buyer (and Finance sees a warning) rather than a wrong one.

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency text not null check (from_currency ~ '^[A-Z]{3}$'),
  to_currency text not null check (to_currency ~ '^[A-Z]{3}$' and to_currency <> from_currency),
  rate numeric(14, 6) not null check (rate > 0), -- 1 from_currency = rate to_currency
  valid_from date not null default current_date,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id),
  unique (from_currency, to_currency, valid_from)
);
alter table public.exchange_rates enable row level security;
create policy "exchange_rates: staff read" on public.exchange_rates for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]));
create policy "exchange_rates: finance insert" on public.exchange_rates for insert to authenticated
  with check (public.has_any_role(array['admin', 'finance']::public.app_role[]));
create policy "exchange_rates: finance update" on public.exchange_rates for update to authenticated
  using (public.has_any_role(array['admin', 'finance']::public.app_role[])) with check (public.has_any_role(array['admin', 'finance']::public.app_role[]));
create policy "exchange_rates: finance delete" on public.exchange_rates for delete to authenticated
  using (public.has_any_role(array['admin', 'finance']::public.app_role[]));

-- Rate to convert an amount from one currency to another on a day (the reverse rate also works).
create or replace function public.fx(p_from text, p_to text, p_on date default current_date)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when p_from = p_to then 1::numeric else coalesce(
    (select rate from exchange_rates where from_currency = p_from and to_currency = p_to and valid_from <= p_on order by valid_from desc limit 1),
    (select 1 / rate from exchange_rates where from_currency = p_to and to_currency = p_from and valid_from <= p_on order by valid_from desc limit 1)
  ) end
$$;

alter table public.margin_rules add column currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$');

-- A farm's price for a product on a day, in another currency (null without a price or a rate).
create or replace function public.farm_price_in(p_farm_id uuid, p_product_id uuid, p_on date, p_currency text)
returns numeric
language sql stable security definer set search_path = public
as $$
  select pl.price_per_stem * public.fx(pl.currency, p_currency, p_on) from price_list pl
  where pl.farm_id = p_farm_id and pl.product_id = p_product_id
    and pl.valid_from <= p_on and (pl.valid_to is null or pl.valid_to >= p_on)
  order by pl.valid_from desc limit 1
$$;

-- The margin per stem for a product under an incoterm, in a currency.
create or replace function public.margin_in(p_incoterm text, p_product_id uuid, p_currency text, p_on date default current_date)
returns numeric
language sql stable security definer set search_path = public
as $$
  select r.margin_per_stem * public.fx(r.currency, p_currency, p_on)
  from margin_rules r
  join products p on p.id = p_product_id
  where r.active
    and r.incoterm = p_incoterm
    and p.stem_length_cm >= r.min_length_cm
    and (r.max_length_cm is null or p.stem_length_cm <= r.max_length_cm)
    and (r.flower_type is null or lower(r.flower_type) = lower(p.flower_type))
  order by (r.flower_type is not null) desc, coalesce(r.max_length_cm, 100000) - r.min_length_cm
  limit 1
$$;

-- Fixed selling prices are per incoterm and currency.
alter table public.price_overrides add column currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$');
alter table public.price_overrides drop constraint price_overrides_product_id_incoterm_key;
alter table public.price_overrides add constraint price_overrides_product_incoterm_currency unique (product_id, incoterm, currency);

-- The buyer's price per stem, in the buyer's currency. See sell_price() in item 5 for the rules.
create or replace function public.sell_price_in(p_incoterm text, p_product_id uuid, p_on date, p_currency text)
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
  m as (select public.margin_in(p_incoterm, p_product_id, p_currency, p_on) as margin)
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

-- Item 5's functions, now in the buyer's currency.


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
  cross join lateral public.sell_price_in(v_customer.incoterm, p.id, current_date, v_customer.currency) sp
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
  where (select price from public.sell_price_in(v_customer.incoterm, p.id, current_date, v_customer.currency)) is null;
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
         public.margin_in(v_customer.incoterm, (l.line ->> 'product_id')::uuid, v_customer.currency), nullif(btrim(l.line ->> 'notes'), ''),
         coalesce(l.line ->> 'bunching', 'standard'), (l.line ->> 'stems_per_bunch')::int,
         (l.line ->> 'sleeves')::boolean, (l.line ->> 'bunch_labels')::boolean,
         (select price from public.sell_price_in(v_customer.incoterm, (l.line ->> 'product_id')::uuid, current_date, v_customer.currency))
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
  v_sell := coalesce(v_line.quoted_price_per_stem, (select price from public.sell_price_in(v_order.incoterm, v_line.product_id, v_on, v_order.currency)));
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
      select v_order, l.line_no, l.product_id, l.stems, public.margin_in(v_customer.incoterm, l.product_id, v_customer.currency, v_day), l.notes, l.bunching, l.stems_per_bunch,
             l.sleeves, l.bunch_labels, (select price from public.sell_price_in(v_customer.incoterm, l.product_id, v_day, v_customer.currency))
      from standing_order_lines l where l.standing_order_id = v_so.id;
      perform public.notify('staff', 'standing_order_due', format('Standing order %s for %s ships %s: place it with farms', v_number,
        v_customer.company_name, to_char(v_day, 'FMDay DD Mon')), null, v_order);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- The proforma and packing list: farm prices converted into the buyer's currency.
create or replace view public.order_packing_list with (security_invoker = true) as
select o.id as order_id, o.order_number, o.customer_id, o.shipment_id, o.incoterm, o.currency,
       po.id as po_id, po.po_number, f.id as farm_id, f.farm_name,
       col.id as order_line_id, col.line_no, col.notes,
       (case when col.quoted_price_per_stem is not null and pol.grower_price_per_stem is not null
             then col.quoted_price_per_stem - pol.grower_price_per_stem * public.fx(f.currency, o.currency, coalesce(po.delivery_date, current_date))
             else col.margin_per_stem end)::numeric(10, 4) as margin_per_stem,
       pol.id as po_line_id, pol.stems_per_box,
       -- The farm's price shown in the buyer's currency, so the whole proforma is in one currency.
       (pol.grower_price_per_stem * public.fx(f.currency, o.currency, coalesce(po.delivery_date, current_date)))::numeric(12, 4) as grower_price_per_stem,
       p.product_code, p.flower_type, p.variety, p.colour, p.stem_length_cm,
       count(b.id) filter (where b.status = 'active')::int as boxes,
       coalesce(sum(b.stems) filter (where b.status = 'active'), 0)::int as stems,
       array_remove(array_agg(b.buyer_box_no order by b.buyer_box_no) filter (where b.status = 'active'), null) as box_numbers
from public.customer_orders o
join public.customer_order_lines col on col.order_id = o.id
join public.purchase_order_lines pol on pol.order_line_id = col.id
join public.purchase_orders po on po.id = pol.po_id
join public.farms f on f.id = po.farm_id
join public.products p on p.id = col.product_id
left join public.boxes b on b.po_line_id = pol.id
group by o.id, po.id, f.id, col.id, pol.id, p.id;

create or replace view public.order_values with (security_invoker = true) as
select o.id as order_id, o.customer_id, o.currency, o.status, o.payment_status, o.shipment_id,
       coalesce((select sum(pl.stems * coalesce(l.quoted_price_per_stem,
                   coalesce(pl.grower_price_per_stem * public.fx(f.currency, o.currency, coalesce(po.delivery_date, current_date)), 0) + coalesce(l.margin_per_stem, 0)))
                 from public.purchase_order_lines pl
                 join public.customer_order_lines l on l.id = pl.order_line_id
                 join public.purchase_orders po on po.id = pl.po_id
                 join public.farms f on f.id = po.farm_id
                 where l.order_id = o.id and po.status <> 'cancelled'), 0)
       -- Lines not placed with farms yet count at the quoted price.
       + coalesce((select sum(greatest(l.stems - coalesce((select sum(pl.stems) from public.purchase_order_lines pl
                                                           join public.purchase_orders po on po.id = pl.po_id
                                                           where pl.order_line_id = l.id and po.status <> 'cancelled'), 0), 0)
                              * coalesce(l.quoted_price_per_stem, 0))
                   from public.customer_order_lines l where l.order_id = o.id), 0)
       + coalesce((select sum(c.amount) from public.order_charges c where c.order_id = o.id), 0) as value
from public.customer_orders o;


-- fx() is used inside the order views, which run as the reader.
revoke execute on function public.fx(text, text, date) from public, anon;
grant execute on function public.fx(text, text, date) to authenticated;
revoke execute on function public.farm_price_in(uuid, uuid, date, text),
  public.margin_in(text, uuid, text, date), public.sell_price_in(text, uuid, date, text) from public, anon, authenticated;

