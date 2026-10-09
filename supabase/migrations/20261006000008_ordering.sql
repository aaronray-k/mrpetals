-- The ordering flow (item 5): buyer catalog and checkout, ConsolFlora approval, the farm cost
-- calculator, farms confirming in full or in part, the packing list step, standing orders and
-- notifications.
--
--   buyer places an order (status submitted) -> staff approve (open) or decline
--   -> staff split each line across farms; the calculator recommends the cheapest farm (or the one
--      Admin pinned) -> farms answer each line in full or in part and confirm the delivery date
--   -> ConsolFlora places any shortfall with another farm -> every stem confirmed
--   -> "Create packing list" makes the boxes -> QC, labels, release (items 3 to 5)
--
-- Timing (Admin settings): an order must be placed min_lead_hours before the end of its ship date
-- (Nairobi time), and farms deliver farm_delivery_hours before the ship date.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.ordering_settings (
  id boolean primary key default true check (id),
  min_lead_hours int not null default 72 check (min_lead_hours between 0 and 720),
  farm_delivery_hours int not null default 48 check (farm_delivery_hours between 0 and 336),
  standing_order_days_ahead int not null default 5 check (standing_order_days_ahead between 1 and 30),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
insert into public.ordering_settings default values;
alter table public.ordering_settings enable row level security;
create policy "ordering_settings: signed-in read" on public.ordering_settings for select to authenticated using (true);
create policy "ordering_settings: admin update" on public.ordering_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke insert, delete on public.ordering_settings from authenticated, anon;
create trigger ordering_settings_touch before update on public.ordering_settings for each row execute function public.touch_updated();

-- The day farms deliver for a ship date.
create or replace function public.farm_delivery_for(p_ship_date date)
returns date
language sql stable security definer set search_path = public
as $$
  select p_ship_date - ceil((select farm_delivery_hours from ordering_settings) / 24.0)::int
$$;

-- The first ship date an order placed now can have.
create or replace function public.earliest_ship_date()
returns date
language sql stable security definer set search_path = public
as $$
  -- A ship date counts until the end of that day in Nairobi.
  select (((now() + make_interval(hours => (select min_lead_hours from ordering_settings))) at time zone 'Africa/Nairobi')
          - interval '1 day' + interval '1 second')::date + 1
$$;

-- ---------------------------------------------------------------------------
-- Selling prices
-- ---------------------------------------------------------------------------
-- Admin can pin the farm to buy a product from, or fix its selling price, per incoterm.
create table public.price_overrides (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  incoterm text not null,
  pinned_farm_id uuid references public.farms (id),
  sell_price_per_stem numeric(12, 4) check (sell_price_per_stem >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (product_id, incoterm),
  check (pinned_farm_id is not null or sell_price_per_stem is not null)
);
alter table public.price_overrides enable row level security;
create policy "price_overrides: staff read" on public.price_overrides for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]));
create policy "price_overrides: admin insert" on public.price_overrides for insert to authenticated with check (public.has_role('admin'));
create policy "price_overrides: admin update" on public.price_overrides for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "price_overrides: admin delete" on public.price_overrides for delete to authenticated using (public.has_role('admin'));
create trigger price_overrides_touch before update on public.price_overrides for each row execute function public.touch_updated();

-- A farm's price for a product on a day.
create or replace function public.farm_price(p_farm_id uuid, p_product_id uuid, p_on date)
returns numeric
language sql stable security definer set search_path = public
as $$
  select pl.price_per_stem from price_list pl
  where pl.farm_id = p_farm_id and pl.product_id = p_product_id
    and pl.valid_from <= p_on and (pl.valid_to is null or pl.valid_to >= p_on)
  order by pl.valid_from desc limit 1
$$;

-- The buyer's price per stem for a product: a fixed selling price, or the pinned farm's price plus
-- margin, or the cheapest farm's price plus margin. Null when no farm has a price.
create or replace function public.sell_price(p_incoterm text, p_product_id uuid, p_on date default current_date)
returns table (price numeric, farm_id uuid, source text)
language sql stable security definer set search_path = public
as $$
  with o as (select * from price_overrides where product_id = p_product_id and incoterm = p_incoterm),
  cheapest as (
    select f.id, public.farm_price(f.id, p_product_id, p_on) as cost
    from farms f where f.active and public.farm_price(f.id, p_product_id, p_on) is not null
    order by 2, f.farm_name limit 1
  )
  select
    case
      when (select sell_price_per_stem from o) is not null then (select sell_price_per_stem from o)
      when (select pinned_farm_id from o) is not null
        then public.farm_price((select pinned_farm_id from o), p_product_id, p_on) + coalesce(public.margin_for(p_incoterm, p_product_id), 0)
      else (select cost from cheapest) + coalesce(public.margin_for(p_incoterm, p_product_id), 0)
    end,
    coalesce((select pinned_farm_id from o), (select id from cheapest)),
    case when (select sell_price_per_stem from o) is not null then 'fixed'
         when (select pinned_farm_id from o) is not null then 'pinned_farm'
         else 'cheapest_farm' end
$$;

-- The catalog a buyer sees: products a farm can supply, with that buyer's price. Staff can look at
-- it as any buyer.
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
         (select count(*)::int from farms f where f.active and public.farm_price(f.id, p.id, current_date) is not null)
  from products p
  cross join lateral public.sell_price(v_customer.incoterm, p.id) sp
  where p.active and sp.price is not null
  order by p.flower_type, p.variety, p.stem_length_cm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders: ship date, approval, bunching, quoted price
-- ---------------------------------------------------------------------------
alter table public.customer_orders drop constraint customer_orders_status_check;
alter table public.customer_orders add constraint customer_orders_status_check check (status in ('submitted', 'open', 'cancelled', 'declined'));
alter table public.customer_orders
  add column ship_date date,
  add column approved_at timestamptz,
  add column approved_by uuid references auth.users (id),
  add column packing_list_at timestamptz,
  add column flight_note text, -- e.g. "New buyer: ConsolFlora may move this to a better flight"
  add column standing_order_id uuid,
  add column standing_date date;

alter table public.customer_order_lines
  add column bunching text not null default 'standard' check (bunching in ('standard', 'custom', 'consolflora')),
  add column stems_per_bunch int check (stems_per_bunch between 1 and 100),
  add column sleeves boolean,
  add column bunch_labels boolean,
  -- The buyer's price when they ordered (catalog orders).
  add column quoted_price_per_stem numeric(12, 4),
  add constraint customer_order_lines_bunching check (bunching <> 'custom' or stems_per_bunch is not null);
grant update (ship_date) on public.customer_orders to authenticated;

-- Farms deliver before the ship date: keep the farm delivery date in step when the ship date moves.
create or replace function public.customer_orders_ship_date()
returns trigger
language plpgsql
as $$
begin
  if new.ship_date is not null and (tg_op = 'INSERT' or new.ship_date is distinct from old.ship_date)
     and (tg_op = 'INSERT' or new.farm_delivery_date is not distinct from old.farm_delivery_date) then
    new.farm_delivery_date := public.farm_delivery_for(new.ship_date);
  end if;
  return new;
end;
$$;
create trigger customer_orders_ship_date before insert or update on public.customer_orders
for each row execute function public.customer_orders_ship_date();

-- Open flights a buyer can choose: to their airport, ship date not before the earliest allowed.
create or replace function public.available_flights(p_customer_id uuid default null)
returns table (shipment_id uuid, shipment_ref text, flight_no text, flight_date date, destination_airport text)
language sql stable security definer set search_path = public
as $$
  select s.id, s.shipment_ref, s.flight_no, s.flight_date, coalesce(s.destination_airport, c.destination_airport)
  from customers c
  join shipments s on s.status = 'open' and s.flight_date >= public.earliest_ship_date()
    and coalesce(s.destination_airport, c.destination_airport) = c.destination_airport
  where c.id = coalesce(p_customer_id, public.my_customer_id())
    and (c.id = public.my_customer_id() or public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]))
  order by s.flight_date, s.shipment_ref
$$;

create or replace function public.check_order_lines(p_lines jsonb)
returns void
language plpgsql stable security definer set search_path = public
as $$
declare v_bad text;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one line.';
  end if;
  select 'Line ' || l.ord || ': ' || case
    when p.id is null then 'the product doesn''t exist.'
    when not p.active then 'product ' || p.product_code || ' is no longer available.'
    when coalesce((l.line ->> 'stems')::numeric, 0) <= 0 or (l.line ->> 'stems')::numeric <> trunc((l.line ->> 'stems')::numeric)
      then 'stems must be a whole number above 0.'
    when coalesce(l.line ->> 'bunching', 'standard') not in ('standard', 'custom', 'consolflora') then 'choose how it is bunched.'
    when l.line ->> 'bunching' = 'custom' and coalesce((l.line ->> 'stems_per_bunch')::int, 0) not between 1 and 100
      then 'give the stems per bunch.'
    end
  into v_bad
  from jsonb_array_elements(p_lines) with ordinality as l (line, ord)
  left join products p on p.id = (l.line ->> 'product_id')::uuid
  where p.id is null or not p.active
     or coalesce((l.line ->> 'stems')::numeric, 0) <= 0 or (l.line ->> 'stems')::numeric <> trunc((l.line ->> 'stems')::numeric)
     or coalesce(l.line ->> 'bunching', 'standard') not in ('standard', 'custom', 'consolflora')
     or (l.line ->> 'bunching' = 'custom' and coalesce((l.line ->> 'stems_per_bunch')::int, 0) not between 1 and 100)
  order by l.ord limit 1;
  if v_bad is not null then raise exception '%', v_bad; end if;
end;
$$;

create or replace function public.next_order_number(p_customer_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_no int;
begin
  insert into customer_order_counters (customer_id, last_no) values (p_customer_id, 1)
  on conflict (customer_id) do update set last_no = customer_order_counters.last_no + 1
  returning last_no into v_no;
  return 'CFL' || (select customer_code from customers where id = p_customer_id) || lpad(v_no::text, 4, '0');
end;
$$;

-- Notifications: shown in the app now; emailed once the mail settings are filled in.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('staff', 'finance', 'customer', 'farm')),
  customer_id uuid references public.customers (id),
  farm_id uuid references public.farms (id),
  kind text not null,
  subject text not null,
  body text,
  order_id uuid references public.customer_orders (id),
  po_id uuid references public.purchase_orders (id),
  -- What the email should carry, e.g. {"proforma": true, "packing_list": true}.
  attachments jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_status text not null default 'waiting' check (email_status in ('waiting', 'sent', 'failed', 'not_needed')),
  check ((audience = 'customer') = (customer_id is not null)),
  check ((audience = 'farm') = (farm_id is not null))
);
create index notifications_recent on public.notifications (created_at desc);
alter table public.notifications enable row level security;
create policy "notifications: read own" on public.notifications for select to authenticated
  using (
    (audience = 'staff' and public.is_staff())
    or (audience = 'finance' and public.has_any_role(array['admin', 'finance']::public.app_role[]))
    or (audience = 'customer' and customer_id = public.my_customer_id())
    or (audience = 'farm' and farm_id = public.my_farm_id())
  );
revoke insert, update, delete on public.notifications from authenticated, anon;

create or replace function public.notify(
  p_audience text, p_kind text, p_subject text, p_body text default null,
  p_order_id uuid default null, p_po_id uuid default null, p_customer_id uuid default null, p_farm_id uuid default null,
  p_attachments jsonb default '{}'
)
returns void
language sql security definer set search_path = public
as $$
  insert into notifications (audience, kind, subject, body, order_id, po_id, customer_id, farm_id, attachments)
  values (p_audience, p_kind, p_subject, p_body, p_order_id, p_po_id, p_customer_id, p_farm_id, coalesce(p_attachments, '{}'))
$$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns void
language sql security definer set search_path = public
as $$
  update notifications n set read_at = now()
  where n.id = any (p_ids) and n.read_at is null
    and ((n.audience = 'staff' and public.is_staff())
      or (n.audience = 'finance' and public.has_any_role(array['admin', 'finance']::public.app_role[]))
      or (n.audience = 'customer' and n.customer_id = public.my_customer_id())
      or (n.audience = 'farm' and n.farm_id = public.my_farm_id()))
$$;

-- A buyer's order from the catalog. p_lines: [{"product_id", "stems", "bunching", "stems_per_bunch",
-- "sleeves", "bunch_labels", "notes"}]. Waits for ConsolFlora to approve it.
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
  where (select price from public.sell_price(v_customer.incoterm, p.id)) is null;
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
         public.margin_for(v_customer.incoterm, (l.line ->> 'product_id')::uuid), nullif(btrim(l.line ->> 'notes'), ''),
         coalesce(l.line ->> 'bunching', 'standard'), (l.line ->> 'stems_per_bunch')::int,
         (l.line ->> 'sleeves')::boolean, (l.line ->> 'bunch_labels')::boolean,
         (select price from public.sell_price(v_customer.incoterm, (l.line ->> 'product_id')::uuid))
  from jsonb_array_elements(p_lines) with ordinality as l (line, ord);
  perform public.notify('staff', 'order_submitted', format('New order %s from %s', v_number, v_customer.company_name), null, v_order);
  return jsonb_build_object('order_id', v_order, 'order_number', v_number, 'ship_date', v_ship);
end;
$$;

create or replace function public.approve_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_order customer_orders%rowtype;
begin
  perform public.require_staff();
  select * into v_order from customer_orders where id = p_order_id for update;
  if not found then raise exception 'This order doesn''t exist.'; end if;
  if v_order.status <> 'submitted' then raise exception 'Order % is not waiting for approval.', v_order.order_number; end if;
  update customer_orders set status = 'open', approved_at = now(), approved_by = auth.uid() where id = p_order_id;
  perform public.notify('customer', 'order_approved', format('Order %s is approved', v_order.order_number),
    'ConsolFlora is confirming it with the farms.', p_order_id, null, v_order.customer_id);
end;
$$;

-- Declining: staff decline new orders; Finance and Admin decline approved ones (e.g. over the
-- credit limit). Replaces the item-5 version.
create or replace function public.decline_order(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_order customer_orders%rowtype;
begin
  select * into v_order from customer_orders where id = p_order_id for update;
  if not found then raise exception 'This order doesn''t exist.'; end if;
  if not (public.is_finance_or_admin() or (v_order.status = 'submitted' and public.is_staff())) then
    raise exception 'Only Finance and Admin users can decline an approved order.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for declining the order.'; end if;
  if v_order.status not in ('submitted', 'open') then raise exception 'Order % is already %.', v_order.order_number, v_order.status; end if;
  if exists (
    select 1 from boxes b join purchase_order_lines pl on pl.id = b.po_line_id join purchase_orders po on po.id = pl.po_id
    where po.order_id = p_order_id and b.status = 'active'
  ) then
    raise exception 'Order % already has boxes. Void them on the shipment first.', v_order.order_number;
  end if;
  update purchase_orders set status = 'cancelled', cancel_reason = 'The order was cancelled by ConsolFlora.'
  where order_id = p_order_id and status <> 'cancelled';
  update customer_orders
  set status = 'declined', decline_reason = btrim(p_reason), declined_at = now(), declined_by = auth.uid()
  where id = p_order_id;
  perform public.notify('customer', 'order_declined', format('Order %s was declined', v_order.order_number), btrim(p_reason), p_order_id, null, v_order.customer_id);
end;
$$;

-- Orders waiting for approval can't be placed with farms yet (replaces item 3's version).
create or replace function public.allocate_order_line(
  p_order_line_id uuid,
  p_farm_id uuid,
  p_stems int,
  p_box_type_id uuid default null,
  p_stems_per_box int default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_line customer_order_lines%rowtype;
  v_order customer_orders%rowtype;
  v_po purchase_orders%rowtype;
  v_box uuid := p_box_type_id;
  v_rate record;
  v_other int;
  v_price numeric;
  v_po_line uuid;
begin
  perform public.require_staff();
  select * into v_line from customer_order_lines where id = p_order_line_id;
  if not found then raise exception 'This order line doesn''t exist.'; end if;
  select * into v_order from customer_orders where id = v_line.order_id;
  if v_order.status = 'submitted' then raise exception 'Approve order % before placing it with farms.', v_order.order_number; end if;
  if v_order.status <> 'open' then raise exception 'Order % is %.', v_order.order_number, v_order.status; end if;
  if not exists (select 1 from farms where id = p_farm_id and active) then
    raise exception 'This farm doesn''t exist or is inactive.';
  end if;
  if coalesce(p_stems, 0) <= 0 then raise exception 'Give the number of stems for this farm.'; end if;

  if v_box is null then
    if (select count(*) from pack_rates where product_id = v_line.product_id) = 1 then
      select box_type_id into v_box from pack_rates where product_id = v_line.product_id;
    else
      raise exception 'Choose a box type: this product has % pack rates.', (select count(*) from pack_rates where product_id = v_line.product_id);
    end if;
  end if;
  select pr.bunches_per_box * p.stems_per_bunch as stems_per_box into v_rate
  from pack_rates pr join products p on p.id = pr.product_id
  where pr.product_id = v_line.product_id and pr.box_type_id = v_box;
  if not found then raise exception 'There is no pack rate for this product in that box type.'; end if;
  if p_stems_per_box is not null and p_stems_per_box <= 0 then raise exception 'Stems per box must be above 0.'; end if;

  select * into v_po from purchase_orders where order_id = v_order.id and farm_id = p_farm_id for update;
  if not found then
    insert into purchase_orders (po_number, order_id, farm_id, delivery_date)
    values ('PO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('po_number_seq')::text, 5, '0'), v_order.id, p_farm_id, v_order.farm_delivery_date)
    returning * into v_po;
  elsif v_po.status in ('sent', 'confirmed') then
    raise exception 'PO % has been sent to the farm, so it can''t change.', v_po.po_number;
  elsif v_po.status = 'declined' then
    update purchase_orders set status = 'draft', responded_at = null, responded_by = null, decline_reason = null where id = v_po.id;
  end if;

  select coalesce(sum(pl.stems), 0) into v_other
  from purchase_order_lines pl where pl.order_line_id = v_line.id and pl.po_id <> v_po.id;
  if v_other + p_stems > v_line.stems then
    raise exception 'Only % of the % stems on this line are left to allocate.', v_line.stems - v_other, v_line.stems;
  end if;

  select pl.price_per_stem into v_price
  from price_list pl
  where pl.farm_id = p_farm_id and pl.product_id = v_line.product_id
    and pl.valid_from <= coalesce(v_po.delivery_date, current_date)
    and (pl.valid_to is null or pl.valid_to >= coalesce(v_po.delivery_date, current_date))
  order by pl.valid_from desc limit 1;

  insert into purchase_order_lines (po_id, order_line_id, product_id, box_type_id, stems, stems_per_box, grower_price_per_stem)
  values (v_po.id, v_line.id, v_line.product_id, v_box, p_stems, coalesce(p_stems_per_box, v_rate.stems_per_box), v_price)
  on conflict (po_id, order_line_id) do update set
    box_type_id = excluded.box_type_id, stems = excluded.stems,
    stems_per_box = excluded.stems_per_box, grower_price_per_stem = excluded.grower_price_per_stem
  returning id into v_po_line;
  return v_po_line;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cost calculator
-- ---------------------------------------------------------------------------
-- For an order line: every farm with a price for the product, cheapest first, with what the buyer
-- pays and ConsolFlora's margin. "recommended" is the pinned farm, else the cheapest.
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
  select pinned_farm_id into v_pinned from price_overrides where product_id = v_line.product_id and incoterm = v_order.incoterm;
  v_sell := coalesce(v_line.quoted_price_per_stem, (select price from public.sell_price(v_order.incoterm, v_line.product_id, v_on)));
  return query
  with options as (
    select f.id, f.farm_code, f.farm_name, public.farm_price(f.id, v_line.product_id, v_on) as cost
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

-- ---------------------------------------------------------------------------
-- Farms answer per line: full or partial
-- ---------------------------------------------------------------------------
alter table public.purchase_order_lines add column requested_stems int check (requested_stems > 0);
alter table public.purchase_orders add column answer_log jsonb not null default '[]';

-- The farm (or staff for the farm) answers a sent PO. p_lines: [{"po_line_id", "stems"}] with the
-- stems the farm can supply (0 to what was asked). Lines not listed are confirmed in full. A line
-- reduced or set to 0 leaves a shortfall on the buyer's order for ConsolFlora to place elsewhere.
create or replace function public.answer_purchase_order(p_po_id uuid, p_lines jsonb default '[]', p_delivery_date date default null, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_po purchase_orders%rowtype;
  v_order customer_orders%rowtype;
  v_line record;
  v_given int;
  v_short int := 0;
  v_left int;
  v_log jsonb := '[]';
begin
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'This PO doesn''t exist.'; end if;
  if not (public.is_staff() or (public.has_role('farm') and v_po.farm_id = public.my_farm_id())) then
    raise exception 'Only the farm or ConsolFlora staff can answer this PO.' using errcode = '42501';
  end if;
  if v_po.status <> 'sent' then raise exception 'PO % is not waiting for an answer.', v_po.po_number; end if;
  select * into v_order from customer_orders where id = v_po.order_id;

  for v_line in select pl.*, p.variety, p.stem_length_cm from purchase_order_lines pl join products p on p.id = pl.product_id where pl.po_id = p_po_id loop
    v_given := (select (x ->> 'stems')::int from jsonb_array_elements(coalesce(p_lines, '[]')) x where (x ->> 'po_line_id')::uuid = v_line.id);
    if v_given is null then v_given := v_line.stems; end if;
    if v_given < 0 or v_given > v_line.stems then
      raise exception '% %cm: give between 0 and % stems.', v_line.variety, v_line.stem_length_cm, v_line.stems;
    end if;
    if v_given < v_line.stems then
      v_short := v_short + (v_line.stems - v_given);
      v_log := v_log || jsonb_build_object('product', v_line.variety || ' ' || v_line.stem_length_cm || 'cm', 'asked', v_line.stems, 'confirmed', v_given);
      if v_given = 0 then
        delete from purchase_order_lines where id = v_line.id;
      else
        update purchase_order_lines set requested_stems = coalesce(requested_stems, stems), stems = v_given where id = v_line.id;
      end if;
    end if;
  end loop;

  select count(*) into v_left from purchase_order_lines where po_id = p_po_id;
  if v_left = 0 and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for declining.';
  end if;
  update purchase_orders
  set status = case when v_left = 0 then 'declined' else 'confirmed' end,
      responded_at = now(), responded_by = auth.uid(),
      decline_reason = case when v_left = 0 then btrim(p_reason) end,
      delivery_date = coalesce(p_delivery_date, delivery_date),
      answer_log = answer_log || jsonb_build_object('at', now(), 'by', auth.uid(), 'short', v_log, 'note', nullif(btrim(coalesce(p_reason, '')), ''))
  where id = p_po_id;

  perform public.notify('staff', case when v_left = 0 then 'po_declined' when v_short > 0 then 'po_partial' else 'po_confirmed' end,
    format('%s %s %s', (select farm_name from farms where id = v_po.farm_id), v_po.po_number,
      case when v_left = 0 then 'declined' when v_short > 0 then format('confirmed in part: %s stems short', v_short) else 'confirmed' end),
    nullif(btrim(coalesce(p_reason, '')), ''), v_po.order_id, p_po_id);
  return jsonb_build_object('status', case when v_left = 0 then 'declined' else 'confirmed' end, 'short_stems', v_short);
end;
$$;

-- Item 3's all-or-nothing answer now goes through the same function.
create or replace function public.respond_purchase_order(p_po_id uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_accept then
    perform public.answer_purchase_order(p_po_id, '[]', null, p_reason);
  else
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for declining.'; end if;
    perform public.answer_purchase_order(p_po_id,
      (select coalesce(jsonb_agg(jsonb_build_object('po_line_id', id, 'stems', 0)), '[]') from purchase_order_lines where po_id = p_po_id),
      null, p_reason);
  end if;
end;
$$;

-- Notify the farm when a PO is sent (wraps item 3's function).
create or replace function public.send_purchase_order(p_po_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_po purchase_orders%rowtype;
begin
  perform public.require_staff();
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'This PO doesn''t exist.'; end if;
  if v_po.status <> 'draft' then raise exception 'PO % has already been sent.', v_po.po_number; end if;
  if exists (select 1 from customer_orders where id = v_po.order_id and status <> 'open') then
    raise exception 'Approve the order before sending POs to farms.';
  end if;
  update purchase_orders set status = 'sent', sent_at = now(), sent_by = auth.uid() where id = p_po_id;
  perform public.notify('farm', 'po_sent', format('New purchase order %s', v_po.po_number),
    format('Please confirm by answering on your ConsolFlora page. Deliver by %s.', to_char(v_po.delivery_date, 'FMDay DD Mon')),
    null, p_po_id, null, v_po.farm_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Coverage, packing list, progress
-- ---------------------------------------------------------------------------
-- Per order line: stems asked, placed with farms (not declined), confirmed by farms, and short.
create view public.order_line_coverage with (security_invoker = true) as
select l.id as order_line_id, l.order_id, l.line_no, l.product_id, l.stems,
       coalesce(sum(pl.stems) filter (where po.status in ('draft', 'sent', 'confirmed')), 0)::int as placed,
       coalesce(sum(pl.stems) filter (where po.status = 'confirmed'), 0)::int as confirmed,
       (l.stems - coalesce(sum(pl.stems) filter (where po.status in ('draft', 'sent', 'confirmed')), 0))::int as short
from public.customer_order_lines l
left join public.purchase_order_lines pl on pl.order_line_id = l.id
left join public.purchase_orders po on po.id = pl.po_id
group by l.id;

-- Once every stem is confirmed, turns the confirmed POs into boxes in one step.
create or replace function public.create_packing_list(p_order_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_order customer_orders%rowtype;
  v_po record;
  v_boxes int := 0;
  v_gap text;
begin
  perform public.require_staff();
  select * into v_order from customer_orders where id = p_order_id for update;
  if not found then raise exception 'This order doesn''t exist.'; end if;
  if v_order.status <> 'open' then raise exception 'Order % isn''t approved.', v_order.order_number; end if;
  select string_agg(format('line %s is %s stems short', c.line_no, c.stems - c.confirmed), ', ' order by c.line_no) into v_gap
  from order_line_coverage c where c.order_id = p_order_id and c.confirmed < c.stems;
  if v_gap is not null then raise exception 'Not every stem is confirmed by a farm yet: %.', v_gap; end if;
  for v_po in select id from purchase_orders where order_id = p_order_id and status = 'confirmed' and boxes_assigned_at is null order by po_number loop
    v_boxes := v_boxes + public.assign_boxes(v_po.id);
  end loop;
  update customer_orders set packing_list_at = now() where id = p_order_id;
  perform public.notify('customer', 'packing_list', format('Packing list for order %s', v_order.order_number),
    'Every farm has confirmed. Your proforma invoice and packing list are attached.', p_order_id, null, v_order.customer_id, null,
    '{"proforma": true, "packing_list": true}');
  return v_boxes;
end;
$$;

-- Where an order is, in steps the buyer understands.
create or replace function public.order_progress(p_order_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with o as (
    select * from customer_orders
    where id = p_order_id
      and (customer_id = public.my_customer_id() or public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]))
  ),
  cov as (select coalesce(sum(stems), 0) as stems, coalesce(sum(confirmed), 0) as confirmed from order_line_coverage where order_id = p_order_id),
  bx as (
    select count(*) filter (where b.status = 'active') as boxes,
           count(*) filter (where b.status = 'active' and b.qc_status = 'passed') as passed,
           count(*) filter (where b.status = 'active' and exists (select 1 from label_prints lp where lp.box_id = b.id)) as labelled
    from boxes b join purchase_order_lines pl on pl.id = b.po_line_id join purchase_orders po on po.id = pl.po_id
    where po.order_id = p_order_id
  )
  select jsonb_build_object(
    'status', o.status,
    'submitted_at', o.created_at,
    'approved_at', o.approved_at,
    'declined_reason', o.decline_reason,
    'stems', cov.stems, 'confirmed_stems', cov.confirmed,
    'farms_confirmed', cov.stems > 0 and cov.confirmed >= cov.stems,
    'packing_list_at', o.packing_list_at,
    'boxes', bx.boxes, 'qc_passed', bx.passed, 'labelled', bx.labelled,
    'shipped', exists (select 1 from shipments s where s.id = o.shipment_id and s.status = 'closed'),
    'ship_date', o.ship_date,
    'flight_note', o.flight_note,
    'payment_status', o.payment_status
  )
  from o, cov, bx
$$;

-- ---------------------------------------------------------------------------
-- Standing orders
-- ---------------------------------------------------------------------------
create table public.standing_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  weekdays int[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]), -- ISO: Monday = 1
  starts_on date not null default current_date,
  ends_on date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
create table public.standing_order_lines (
  id uuid primary key default gen_random_uuid(),
  standing_order_id uuid not null references public.standing_orders (id) on delete cascade,
  line_no int not null,
  product_id uuid not null references public.products (id),
  stems int not null check (stems > 0),
  bunching text not null default 'standard' check (bunching in ('standard', 'custom', 'consolflora')),
  stems_per_bunch int check (stems_per_bunch between 1 and 100),
  sleeves boolean,
  bunch_labels boolean,
  notes text,
  unique (standing_order_id, line_no)
);
-- Weeks the buyer skipped.
create table public.standing_order_skips (
  standing_order_id uuid not null references public.standing_orders (id) on delete cascade,
  ship_date date not null,
  primary key (standing_order_id, ship_date)
);
alter table public.customer_orders add constraint customer_orders_standing_fk foreign key (standing_order_id) references public.standing_orders (id);
create unique index customer_orders_standing_once on public.customer_orders (standing_order_id, standing_date) where standing_order_id is not null;

alter table public.standing_orders enable row level security;
alter table public.standing_order_lines enable row level security;
alter table public.standing_order_skips enable row level security;
create policy "standing_orders: read" on public.standing_orders for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) or customer_id = public.my_customer_id());
create policy "standing_order_lines: read" on public.standing_order_lines for select to authenticated
  using (exists (select 1 from public.standing_orders s where s.id = standing_order_id
                 and (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) or s.customer_id = public.my_customer_id())));
create policy "standing_order_skips: read" on public.standing_order_skips for select to authenticated
  using (exists (select 1 from public.standing_orders s where s.id = standing_order_id
                 and (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) or s.customer_id = public.my_customer_id())));
revoke insert, update, delete on public.standing_orders, public.standing_order_lines, public.standing_order_skips from authenticated, anon;

-- Creates or replaces a standing order (the buyer for themselves, or staff for a buyer).
create or replace function public.save_standing_order(
  p_id uuid, p_customer_id uuid, p_weekdays int[], p_lines jsonb, p_active boolean default true,
  p_starts_on date default current_date, p_ends_on date default null, p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_customer uuid := coalesce(p_customer_id, public.my_customer_id());
  v_id uuid := p_id;
  v_existing standing_orders%rowtype;
begin
  if not (public.is_staff() or (public.has_role('customer') and v_customer = public.my_customer_id())) then
    raise exception 'Only the buyer or ConsolFlora staff can change this standing order.' using errcode = '42501';
  end if;
  if v_customer is null then raise exception 'Choose the buyer.'; end if;
  if coalesce(cardinality(p_weekdays), 0) = 0 then raise exception 'Choose at least one ship day.'; end if;
  perform public.check_order_lines(p_lines);
  if v_id is null then
    insert into standing_orders (customer_id, weekdays, active, starts_on, ends_on, notes)
    values (v_customer, p_weekdays, p_active, p_starts_on, p_ends_on, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_id;
  else
    select * into v_existing from standing_orders where id = v_id and customer_id = v_customer for update;
    if not found then raise exception 'This standing order doesn''t exist.'; end if;
    update standing_orders set weekdays = p_weekdays, active = p_active, starts_on = p_starts_on, ends_on = p_ends_on,
      notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = v_id;
    delete from standing_order_lines where standing_order_id = v_id;
  end if;
  insert into standing_order_lines (standing_order_id, line_no, product_id, stems, bunching, stems_per_bunch, sleeves, bunch_labels, notes)
  select v_id, l.ord, (l.line ->> 'product_id')::uuid, (l.line ->> 'stems')::int, coalesce(l.line ->> 'bunching', 'standard'),
         (l.line ->> 'stems_per_bunch')::int, (l.line ->> 'sleeves')::boolean, (l.line ->> 'bunch_labels')::boolean, nullif(btrim(l.line ->> 'notes'), '')
  from jsonb_array_elements(p_lines) with ordinality as l (line, ord);
  perform public.notify('customer', 'standing_order_changed', 'Your standing order was ' || case when p_id is null then 'set up' else 'changed' end,
    format('Ships every %s. Each week''s proforma and packing list follow.',
      (select string_agg(to_char(date '2024-01-01' + (d - 1), 'FMDay'), ' and ' order by d) from unnest(p_weekdays) d)),
    null, null, v_customer, null, '{"proforma": true, "packing_list": true}');
  perform public.notify('staff', 'standing_order_changed', format('Standing order %s for %s',
    case when p_id is null then 'set up' else 'changed' end, (select company_name from customers where id = v_customer)));
  return v_id;
end;
$$;

create or replace function public.skip_standing_order_week(p_id uuid, p_ship_date date, p_skip boolean default true)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_so standing_orders%rowtype;
begin
  select * into v_so from standing_orders where id = p_id;
  if not found or not (public.is_staff() or v_so.customer_id = public.my_customer_id()) then
    raise exception 'This standing order doesn''t exist.';
  end if;
  if p_skip then
    if exists (select 1 from customer_orders where standing_order_id = p_id and standing_date = p_ship_date) then
      raise exception 'The order for % is already with the farms. Message ConsolFlora to change it.', to_char(p_ship_date, 'FMDay DD Mon');
    end if;
    insert into standing_order_skips values (p_id, p_ship_date) on conflict do nothing;
  else
    delete from standing_order_skips where standing_order_id = p_id and ship_date = p_ship_date;
  end if;
  perform public.notify('staff', 'standing_order_changed', format('%s %s the %s standing order', (select company_name from customers where id = v_so.customer_id),
    case when p_skip then 'skipped' else 'restored' end, to_char(p_ship_date, 'FMDay DD Mon')));
end;
$$;

-- Creates the orders for standing orders shipping within the next standing_order_days_ahead days.
-- Safe to run as often as you like (hourly from the scheduler). Returns how many orders it made.
-- Standing orders are pre-agreed, so their orders start approved.
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
      select v_order, l.line_no, l.product_id, l.stems, public.margin_for(v_customer.incoterm, l.product_id), l.notes, l.bunching, l.stems_per_bunch,
             l.sleeves, l.bunch_labels, (select price from public.sell_price(v_customer.incoterm, l.product_id, v_day))
      from standing_order_lines l where l.standing_order_id = v_so.id;
      perform public.notify('staff', 'standing_order_due', format('Standing order %s for %s ships %s: place it with farms', v_number,
        v_customer.company_name, to_char(v_day, 'FMDay DD Mon')), null, v_order);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function public.notify(text, text, text, text, uuid, uuid, uuid, uuid, jsonb), public.next_order_number(uuid),
  public.check_order_lines(jsonb) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'farm_delivery_for(date)', 'earliest_ship_date()', 'farm_price(uuid, uuid, date)', 'sell_price(text, uuid, date)',
    'catalog(uuid)', 'available_flights(uuid)', 'place_order(uuid, date, jsonb, text)', 'approve_order(uuid)',
    'decline_order(uuid, text)', 'line_farm_options(uuid)', 'answer_purchase_order(uuid, jsonb, date, text)',
    'respond_purchase_order(uuid, boolean, text)', 'send_purchase_order(uuid)', 'create_packing_list(uuid)',
    'order_progress(uuid)', 'save_standing_order(uuid, uuid, int[], jsonb, boolean, date, date, text)',
    'skip_standing_order_week(uuid, date, boolean)', 'generate_standing_orders(date)', 'mark_notifications_read(uuid[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- farm_price and sell_price reveal farm costs: staff only, through catalog() and line_farm_options() for others.
revoke execute on function public.farm_price(uuid, uuid, date), public.sell_price(text, uuid, date) from authenticated;

-- ---------------------------------------------------------------------------
-- Money: catalog orders are priced at what the buyer was quoted
-- ---------------------------------------------------------------------------
-- The buyer pays the quoted price; ConsolFlora's margin on each farm line is quoted price minus that
-- farm's price. Staff-entered orders keep the margin per stem as before.
create or replace view public.order_packing_list with (security_invoker = true) as
select o.id as order_id, o.order_number, o.customer_id, o.shipment_id, o.incoterm, o.currency,
       po.id as po_id, po.po_number, f.id as farm_id, f.farm_name,
       col.id as order_line_id, col.line_no, col.notes,
       (case when col.quoted_price_per_stem is not null and pol.grower_price_per_stem is not null
             then col.quoted_price_per_stem - pol.grower_price_per_stem else col.margin_per_stem end)::numeric(10, 4) as margin_per_stem,
       pol.id as po_line_id, pol.stems_per_box, pol.grower_price_per_stem,
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
       coalesce((select sum(pl.stems * coalesce(l.quoted_price_per_stem, coalesce(pl.grower_price_per_stem, 0) + coalesce(l.margin_per_stem, 0)))
                 from public.purchase_order_lines pl
                 join public.customer_order_lines l on l.id = pl.order_line_id
                 join public.purchase_orders po on po.id = pl.po_id
                 where l.order_id = o.id and po.status <> 'cancelled'), 0)
       -- Lines not placed with farms yet count at the quoted price.
       + coalesce((select sum(greatest(l.stems - coalesce((select sum(pl.stems) from public.purchase_order_lines pl
                                                           join public.purchase_orders po on po.id = pl.po_id
                                                           where pl.order_line_id = l.id and po.status <> 'cancelled'), 0), 0)
                              * coalesce(l.quoted_price_per_stem, 0))
                   from public.customer_order_lines l where l.order_id = o.id), 0)
       + coalesce((select sum(c.amount) from public.order_charges c where c.order_id = o.id), 0) as value
from public.customer_orders o;

-- New orders waiting for approval count against the credit limit too.
create or replace view public.buyer_credit with (security_invoker = true) as
select c.id as customer_id, c.customer_code, c.company_name, c.currency, c.payment_terms,
       (c.payment_terms = 'Prepaid') as is_prepaid,
       c.credit_limit,
       coalesce(sum(v.value) filter (where v.status in ('submitted', 'open') and v.payment_status = 'unpaid'), 0) as open_value,
       (c.payment_terms <> 'Prepaid' and c.credit_limit is not null
        and coalesce(sum(v.value) filter (where v.status in ('submitted', 'open') and v.payment_status = 'unpaid'), 0) > c.credit_limit) as over_limit
from public.customers c
left join public.order_values v on v.customer_id = c.id
group by c.id;
