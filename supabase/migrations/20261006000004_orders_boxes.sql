-- Buyer orders, farm purchase orders and boxes (item 3).
--
-- Flow: a buyer orders in stems -> ConsolFlora staff split each line across farms, which makes
-- one purchase order (PO) per farm -> the farm confirms -> "Assign boxes" turns stems into boxes
-- -> boxes are received and pass QC -> labels print -> closing the shipment freezes numbering.
--
-- Box ids come from a sequence and never change. "Box n of N" counts each buyer's active boxes in
-- the shipment in the order they were created; voiding a box closes the gap until the shipment is
-- closed, after which numbers are frozen. Boxes are only ever changed through the functions below.

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

-- ConsolFlora quotes FOB Nairobi; the import template's list only had air-freight terms.
insert into public.lookup_values (list_name, value, sort_order) values ('Incoterm', 'FOB', 0)
on conflict (list_name, value) do nothing;

alter table public.shipments
  add column flight_no text,
  add column flight_date date,
  add column origin_airport text not null default 'NBO' check (origin_airport ~ '^[A-Z]{3}$'),
  add column destination_airport text check (destination_airport ~ '^[A-Z]{3}$');

-- ConsolFlora's margin per stem, by incoterm and stem length (optionally per flower type).
create table public.margin_rules (
  id uuid primary key default gen_random_uuid(),
  incoterm text not null,
  flower_type text, -- null: any flower
  min_length_cm int not null default 0 check (min_length_cm >= 0),
  max_length_cm int check (max_length_cm is null or max_length_cm >= min_length_cm),
  margin_per_stem numeric(10, 4) not null check (margin_per_stem >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
-- From the FOB proforma ConsolFlora uses today.
insert into public.margin_rules (incoterm, min_length_cm, max_length_cm, margin_per_stem)
values ('FOB', 0, 50, 0.010), ('FOB', 51, null, 0.015);

-- The margin for a product under an incoterm: a rule for its flower type beats a general one,
-- and a narrower length band beats a wider one. Null when no rule applies.
create or replace function public.margin_for(p_incoterm text, p_product_id uuid)
returns numeric
language sql stable security invoker set search_path = public
as $$
  select r.margin_per_stem
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

-- ---------------------------------------------------------------------------
-- Buyer orders
-- ---------------------------------------------------------------------------

-- Per-buyer order counter for numbers like CFLPFJ0041. Only the functions below touch it.
create table public.customer_order_counters (
  customer_id uuid primary key references public.customers (id),
  last_no int not null default 0
);

create table public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers (id),
  shipment_id uuid references public.shipments (id),
  incoterm text not null,
  currency text not null,
  -- When the farms deliver to ConsolFlora.
  farm_delivery_date date,
  status text not null default 'open' check (status in ('open', 'cancelled')),
  source text not null default 'staff' check (source in ('self_order', 'staff')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
create index customer_orders_customer_idx on public.customer_orders (customer_id);
create index customer_orders_shipment_idx on public.customer_orders (shipment_id);

create table public.customer_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_orders (id),
  line_no int not null check (line_no >= 1),
  product_id uuid not null references public.products (id),
  stems int not null check (stems > 0),
  margin_per_stem numeric(10, 4) check (margin_per_stem >= 0), -- null: no rule, set by hand
  notes text, -- e.g. "Bunching by 3"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (order_id, line_no)
);

-- Other costs on the proforma: consolidation fee, data logger, labelling, UCR...
create table public.order_charges (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_orders (id),
  description text not null check (length(btrim(description)) between 1 and 80),
  amount numeric(12, 2) not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

-- ---------------------------------------------------------------------------
-- Farm purchase orders
-- ---------------------------------------------------------------------------

-- PO numbers don't show the buyer: farms only see ConsolFlora as their customer.
create sequence public.po_number_seq;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  order_id uuid not null references public.customer_orders (id),
  farm_id uuid not null references public.farms (id),
  delivery_date date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'confirmed', 'declined')),
  sent_at timestamptz,
  sent_by uuid references auth.users (id),
  responded_at timestamptz,
  responded_by uuid references auth.users (id),
  decline_reason text,
  boxes_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (order_id, farm_id)
);
create index purchase_orders_farm_idx on public.purchase_orders (farm_id);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id),
  order_line_id uuid not null references public.customer_order_lines (id),
  product_id uuid not null references public.products (id), -- copy of the order line's, for the farm's view
  box_type_id uuid not null references public.box_types (id),
  stems int not null check (stems > 0),
  stems_per_box int not null check (stems_per_box > 0),
  grower_price_per_stem numeric(12, 4) check (grower_price_per_stem >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (po_id, order_line_id)
);

-- ---------------------------------------------------------------------------
-- Boxes
-- ---------------------------------------------------------------------------

-- Eight-digit ids, so a box id never looks like a box number.
create sequence public.box_id_seq start with 10000001;

create table public.boxes (
  id bigint primary key default nextval('public.box_id_seq'),
  po_line_id uuid not null references public.purchase_order_lines (id),
  shipment_id uuid not null references public.shipments (id),
  customer_id uuid not null references public.customers (id),
  farm_id uuid not null references public.farms (id),
  product_id uuid not null references public.products (id),
  box_type_id uuid not null references public.box_types (id),
  stems int not null check (stems > 0),
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  received_at timestamptz,
  received_by uuid references auth.users (id),
  qc_status text not null default 'pending' check (qc_status in ('pending', 'passed', 'failed')),
  qc_note text,
  qc_at timestamptz,
  qc_by uuid references auth.users (id),
  -- "Box n of N" within the buyer's boxes in the shipment, and "Farm box n of N" within the farm's.
  buyer_box_no int,
  buyer_box_total int,
  farm_box_no int,
  farm_box_total int,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id),
  check (status = 'active' or length(btrim(coalesce(void_reason, ''))) >= 3),
  check (qc_status <> 'failed' or length(btrim(coalesce(qc_note, ''))) >= 3)
);
alter sequence public.box_id_seq owned by public.boxes.id;
create index boxes_shipment_customer_idx on public.boxes (shipment_id, customer_id);
create index boxes_po_line_idx on public.boxes (po_line_id);
create index boxes_farm_idx on public.boxes (farm_id);

create or replace function public.boxes_keep_id()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id then
    raise exception 'Box ids never change.';
  end if;
  return new;
end;
$$;
create trigger boxes_keep_id before update on public.boxes for each row execute function public.boxes_keep_id();

-- Prints now point at real boxes and remember the numbers they showed.
alter table public.label_prints
  add constraint label_prints_box_fk foreign key (box_id) references public.boxes (id),
  add column buyer_box_no int,
  add column buyer_box_total int,
  add column farm_box_no int,
  add column farm_box_total int;
-- Prints are logged by print_labels() only, together with the eligibility check.
drop policy "label_prints: printers log own" on public.label_prints;

-- ---------------------------------------------------------------------------
-- Triggers and RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['margin_rules', 'customer_orders', 'customer_order_lines', 'order_charges', 'purchase_orders', 'purchase_order_lines']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated()', t || '_touch', t);
  end loop;
  foreach t in array array['margin_rules', 'customer_order_counters', 'customer_orders', 'customer_order_lines', 'order_charges', 'purchase_orders', 'purchase_order_lines', 'boxes']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- An order can't move to another shipment once it has boxes, or into a closed one.
-- A new incoterm re-applies that incoterm's margins to the order's lines.
create or replace function public.customer_orders_guard()
returns trigger
language plpgsql
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
    update public.customer_order_lines l set margin_per_stem = public.margin_for(new.incoterm, l.product_id) where l.order_id = new.id;
  end if;
  return new;
end;
$$;
create trigger customer_orders_guard before update on public.customer_orders for each row execute function public.customer_orders_guard();

-- Margins: staff and Finance read; Admin and Finance set them.
create policy "margin_rules: read" on public.margin_rules for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]));
create policy "margin_rules: admin or finance insert" on public.margin_rules for insert to authenticated
  with check (public.has_any_role(array['admin', 'finance']::public.app_role[]));
create policy "margin_rules: admin or finance update" on public.margin_rules for update to authenticated
  using (public.has_any_role(array['admin', 'finance']::public.app_role[]))
  with check (public.has_any_role(array['admin', 'finance']::public.app_role[]));

-- Orders: staff and Finance see all; a buyer sees their own.
create policy "customer_orders: read" on public.customer_orders for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) or customer_id = public.my_customer_id());
create policy "customer_orders: staff update" on public.customer_orders for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "customer_order_lines: read" on public.customer_order_lines for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[])
    or exists (select 1 from public.customer_orders o where o.id = order_id and o.customer_id = public.my_customer_id())
  );
create policy "customer_order_lines: staff update" on public.customer_order_lines for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "order_charges: read" on public.order_charges for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[])
    or exists (select 1 from public.customer_orders o where o.id = order_id and o.customer_id = public.my_customer_id())
  );
create policy "order_charges: staff insert" on public.order_charges for insert to authenticated with check (public.is_staff());
create policy "order_charges: staff update" on public.order_charges for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "order_charges: staff delete" on public.order_charges for delete to authenticated using (public.is_staff());

-- POs: staff and Finance see all; a farm sees its own once sent (but not the buyer's order).
create policy "purchase_orders: read" on public.purchase_orders for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[])
    or (farm_id = public.my_farm_id() and status <> 'draft')
  );
create policy "purchase_orders: staff update" on public.purchase_orders for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "purchase_order_lines: read" on public.purchase_order_lines for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[])
    or exists (select 1 from public.purchase_orders po where po.id = po_id and po.farm_id = public.my_farm_id() and po.status <> 'draft')
  );

-- Boxes: everyone involved can read; nobody writes directly.
create policy "boxes: read" on public.boxes for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance', 'qc']::public.app_role[])
    or farm_id = public.my_farm_id()
    or customer_id = public.my_customer_id()
  );

-- Status changes, numbers and box rows only change through the functions below.
revoke insert, update, delete on public.customer_orders, public.customer_order_lines, public.purchase_orders,
  public.purchase_order_lines, public.boxes, public.customer_order_counters from authenticated, anon;
grant update (shipment_id, farm_delivery_date, incoterm, notes) on public.customer_orders to authenticated;
grant update (margin_per_stem, notes) on public.customer_order_lines to authenticated;
grant update (delivery_date) on public.purchase_orders to authenticated;

drop policy "shipments: read" on public.shipments;
create policy "shipments: read" on public.shipments for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance', 'qc']::public.app_role[])
    or exists (
      select 1 from public.packing_list_lines l
      where l.shipment_id = shipments.id and (l.farm_id = public.my_farm_id() or l.customer_id = public.my_customer_id())
    )
    or exists (select 1 from public.customer_orders o where o.shipment_id = shipments.id and o.customer_id = public.my_customer_id())
    or exists (select 1 from public.boxes b where b.shipment_id = shipments.id and b.farm_id = public.my_farm_id())
  );

-- ---------------------------------------------------------------------------
-- Functions. security definer + explicit role checks: they are the only way to change these rows.
-- ---------------------------------------------------------------------------

create or replace function public.require_staff()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Only Admin and Consolidator users can do this.' using errcode = '42501';
  end if;
end;
$$;

-- A buyer's order. p_lines: [{"product_id": "...", "stems": 1000, "notes": "Bunching by 3"}]
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
         public.margin_for(v_incoterm, (l.line ->> 'product_id')::uuid), nullif(btrim(l.line ->> 'notes'), '')
  from jsonb_array_elements(p_lines) with ordinality as l (line, ord);

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_number);
end;
$$;

-- Sends part of an order line to a farm: creates the farm's PO for the order if needed.
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
  if v_order.status <> 'open' then raise exception 'Order % is cancelled.', v_order.order_number; end if;
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

create or replace function public.remove_allocation(p_po_line_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_po purchase_orders%rowtype;
begin
  perform public.require_staff();
  select po.* into v_po from purchase_orders po join purchase_order_lines pl on pl.po_id = po.id where pl.id = p_po_line_id for update of po;
  if not found then raise exception 'This allocation doesn''t exist.'; end if;
  if v_po.status in ('sent', 'confirmed') then
    raise exception 'PO % has been sent to the farm, so it can''t change.', v_po.po_number;
  end if;
  delete from purchase_order_lines where id = p_po_line_id;
  if not exists (select 1 from purchase_order_lines where po_id = v_po.id) then
    delete from purchase_orders where id = v_po.id;
  end if;
end;
$$;

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
  update purchase_orders set status = 'sent', sent_at = now(), sent_by = auth.uid() where id = p_po_id;
end;
$$;

-- Sets the grower price on a PO line when the price list had none (or it was agreed differently).
create or replace function public.set_grower_price(p_po_line_id uuid, p_price numeric)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_staff();
  if p_price is null or p_price < 0 then raise exception 'Enter a price of 0 or more.'; end if;
  update purchase_order_lines set grower_price_per_stem = p_price where id = p_po_line_id;
  if not found then raise exception 'This allocation doesn''t exist.'; end if;
end;
$$;

-- The farm (or staff on its behalf) confirms or declines a sent PO.
create or replace function public.respond_purchase_order(p_po_id uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_po purchase_orders%rowtype;
begin
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'This PO doesn''t exist.'; end if;
  if not (public.is_staff() or (public.has_role('farm') and v_po.farm_id = public.my_farm_id())) then
    raise exception 'Only the farm or ConsolFlora staff can answer this PO.' using errcode = '42501';
  end if;
  if v_po.status <> 'sent' then
    raise exception 'PO % is not waiting for an answer.', v_po.po_number;
  end if;
  if not p_accept and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for declining.';
  end if;
  update purchase_orders
  set status = case when p_accept then 'confirmed' else 'declined' end,
      responded_at = now(), responded_by = auth.uid(),
      decline_reason = case when p_accept then null else btrim(p_reason) end
  where id = p_po_id;
end;
$$;

-- Recounts "Box n of N" (per buyer) and "Farm box n of N" for one buyer in a shipment.
-- Does nothing once the shipment is closed: numbers are frozen then.
create or replace function public.renumber_boxes(p_shipment_id uuid, p_customer_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from shipments where id = p_shipment_id and status = 'closed') then
    return;
  end if;
  with numbered as (
    select id,
           row_number() over (order by id) as n,
           count(*) over () as total,
           row_number() over (partition by farm_id order by id) as fn,
           count(*) over (partition by farm_id) as ftotal
    from boxes
    where shipment_id = p_shipment_id and customer_id = p_customer_id and status = 'active'
  )
  update boxes b
  set buyer_box_no = x.n, buyer_box_total = x.total, farm_box_no = x.fn, farm_box_total = x.ftotal
  from numbered x
  where x.id = b.id
    and (b.buyer_box_no, b.buyer_box_total, b.farm_box_no, b.farm_box_total) is distinct from (x.n::int, x.total::int, x.fn::int, x.ftotal::int);

  update boxes
  set buyer_box_no = null, buyer_box_total = null, farm_box_no = null, farm_box_total = null
  where shipment_id = p_shipment_id and customer_id = p_customer_id and status = 'void' and buyer_box_no is not null;
end;
$$;

-- Turns a confirmed PO's stems into boxes: stems / stems per box, rounded up; the last box holds the rest.
create or replace function public.assign_boxes(p_po_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_po purchase_orders%rowtype;
  v_order customer_orders%rowtype;
  v_line record;
  v_count int := 0;
  v_n int;
begin
  perform public.require_staff();
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'This PO doesn''t exist.'; end if;
  if v_po.status <> 'confirmed' then raise exception 'PO % isn''t confirmed by the farm yet.', v_po.po_number; end if;
  if v_po.boxes_assigned_at is not null then raise exception 'PO % already has its boxes.', v_po.po_number; end if;
  select * into v_order from customer_orders where id = v_po.order_id;
  if v_order.shipment_id is null then
    raise exception 'Order % has no shipment yet. Choose the shipment first.', v_order.order_number;
  end if;
  if exists (select 1 from shipments where id = v_order.shipment_id and status = 'closed') then
    raise exception 'The shipment for order % is closed.', v_order.order_number;
  end if;

  for v_line in select * from purchase_order_lines where po_id = p_po_id order by created_at, id loop
    v_n := ceil(v_line.stems::numeric / v_line.stems_per_box)::int;
    insert into boxes (po_line_id, shipment_id, customer_id, farm_id, product_id, box_type_id, stems)
    select v_line.id, v_order.shipment_id, v_order.customer_id, v_po.farm_id, v_line.product_id, v_line.box_type_id,
           case when i < v_n then v_line.stems_per_box else v_line.stems - v_line.stems_per_box * (v_n - 1) end
    from generate_series(1, v_n) as i
    order by i;
    v_count := v_count + v_n;
  end loop;

  update purchase_orders set boxes_assigned_at = now() where id = p_po_id;
  perform public.renumber_boxes(v_order.shipment_id, v_order.customer_id);
  return v_count;
end;
$$;

create or replace function public.void_box(p_box_id bigint, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_box boxes%rowtype;
begin
  perform public.require_staff();
  select * into v_box from boxes where id = p_box_id for update;
  if not found then raise exception 'Box % doesn''t exist.', p_box_id; end if;
  if v_box.status = 'void' then raise exception 'Box % is already void.', p_box_id; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for voiding the box.'; end if;
  update boxes set status = 'void', void_reason = btrim(p_reason), voided_at = now(), voided_by = auth.uid() where id = p_box_id;
  perform public.renumber_boxes(v_box.shipment_id, v_box.customer_id);
end;
$$;

-- Boxes delivered by the farm. Returns how many were newly received.
create or replace function public.receive_boxes(p_box_ids bigint[])
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  perform public.require_staff();
  update boxes set received_at = now(), received_by = auth.uid()
  where id = any (p_box_ids) and status = 'active' and received_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.set_qc_result(p_box_ids bigint[], p_passed boolean, p_note text default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
  v_waiting bigint;
begin
  if not public.has_any_role(array['admin', 'consolidator', 'qc']::public.app_role[]) then
    raise exception 'Only QC, Admin and Consolidator users can record QC results.' using errcode = '42501';
  end if;
  if not p_passed and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why the boxes failed QC.';
  end if;
  select id into v_waiting from boxes where id = any (p_box_ids) and status = 'active' and received_at is null limit 1;
  if v_waiting is not null then
    raise exception 'Box % hasn''t been received yet, so it can''t be checked.', v_waiting;
  end if;
  update boxes
  set qc_status = case when p_passed then 'passed' else 'failed' end,
      qc_note = nullif(btrim(coalesce(p_note, '')), ''), qc_at = now(), qc_by = auth.uid()
  where id = any (p_box_ids) and status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.close_shipment(p_shipment_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_ref text;
begin
  perform public.require_staff();
  select shipment_ref into v_ref from shipments where id = p_shipment_id and status = 'open' for update;
  if not found then raise exception 'This shipment is already closed or doesn''t exist.'; end if;
  update shipments set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_shipment_id;
end;
$$;

-- Everything a box label can show (see src/lib/labels/data.ts).
create or replace function public.box_label_data(p_box_id bigint)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'boxId', b.id,
    'boxNo', b.buyer_box_no, 'boxTotal', b.buyer_box_total,
    'farmBoxNo', b.farm_box_no, 'farmBoxTotal', b.farm_box_total,
    'shipmentRef', s.shipment_ref, 'mawb', s.mawb, 'hawb', null, 'poNumber', po.po_number,
    'customerCode', c.customer_code, 'customerName', c.company_name,
    'destinationAirport', coalesce(s.destination_airport, c.destination_airport), 'destinationCountry', c.country,
    'farmCode', f.farm_code, 'farmName', f.farm_name, 'originCountry', f.country, 'originAirport', s.origin_airport,
    'productCode', p.product_code, 'flowerType', p.flower_type, 'variety', p.variety, 'colour', p.colour,
    'grade', p.grade, 'stemLengthCm', p.stem_length_cm, 'headSizeCm', p.head_size_cm, 'maturity', p.maturity,
    'vbnCode', p.vbn_code, 'stemsPerBunch', p.stems_per_bunch,
    'bunchesPerBox', ceil(b.stems::numeric / p.stems_per_bunch)::int, 'stemsPerBox', b.stems,
    'boxCode', bt.box_code, 'boxDescription', bt.description, 'grossWeightKg', pr.est_gross_weight_kg,
    'packDate', to_char(coalesce(b.received_at, now()), 'YYYY-MM-DD')
  )
  from boxes b
  join shipments s on s.id = b.shipment_id
  join customers c on c.id = b.customer_id
  join farms f on f.id = b.farm_id
  join products p on p.id = b.product_id
  join box_types bt on bt.id = b.box_type_id
  join purchase_order_lines pol on pol.id = b.po_line_id
  join purchase_orders po on po.id = pol.po_id
  left join pack_rates pr on pr.product_id = b.product_id and pr.box_type_id = b.box_type_id
  where b.id = p_box_id
$$;

-- Checks the boxes may be printed, logs the prints, and returns what to print.
-- A box prints once the farm confirmed it, it was received, and it passed QC. Printing a box
-- again is a reprint and needs a reason; reprints carry the REPRINT mark.
create or replace function public.print_labels(p_box_ids bigint[], p_reason text default null)
returns table (
  box_id bigint,
  kind text,
  template_version_id uuid,
  width_mm numeric,
  height_mm numeric,
  orientation text,
  layout jsonb,
  data jsonb
)
language plpgsql security definer set search_path = public
as $$
declare
  v_problem text;
  v_reprints bigint[];
  v_no_template text;
begin
  if not public.has_any_role(array['admin', 'consolidator', 'qc']::public.app_role[]) then
    raise exception 'Only QC, Admin and Consolidator users can print labels.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_box_ids, 1), 0) = 0 then
    raise exception 'Choose the boxes to print.';
  end if;

  select format('Box %s can''t be printed yet: %s.', x.id, x.why) into v_problem
  from (
    select ids.id,
      case
        when b.id is null then 'it doesn''t exist'
        when b.status = 'void' then 'it is void'
        when po.status <> 'confirmed' then 'the farm hasn''t confirmed it'
        when b.received_at is null then 'it hasn''t been received'
        when b.qc_status <> 'passed' then 'it hasn''t passed QC'
      end as why
    from unnest(p_box_ids) as ids (id)
    left join boxes b on b.id = ids.id
    left join purchase_order_lines pol on pol.id = b.po_line_id
    left join purchase_orders po on po.id = pol.po_id
  ) x
  where x.why is not null
  order by x.id limit 1;
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;

  select array_agg(distinct lp.box_id order by lp.box_id) into v_reprints
  from label_prints lp where lp.box_id = any (p_box_ids);
  if v_reprints is not null and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Box % was printed before. Give a reason to reprint.', array_to_string(v_reprints[1:5], ', ');
  end if;

  select c.company_name into v_no_template
  from boxes b join customers c on c.id = b.customer_id
  where b.id = any (p_box_ids) and public.label_template_version_for(b.customer_id) is null
  limit 1;
  if v_no_template is not null then
    raise exception 'There is no label template for % and no default template. Create one in the Label designer.', v_no_template;
  end if;

  return query
  with picked as (
    select b.*, public.label_template_version_for(b.customer_id) as version_id,
           (b.id = any (coalesce(v_reprints, '{}'))) as is_reprint
    from boxes b where b.id = any (p_box_ids)
  ),
  logged as (
    insert into label_prints (box_id, template_version_id, kind, reason, buyer_box_no, buyer_box_total, farm_box_no, farm_box_total)
    select p.id, p.version_id, case when p.is_reprint then 'reprint' else 'print' end,
           case when p.is_reprint then btrim(p_reason) end,
           p.buyer_box_no, p.buyer_box_total, p.farm_box_no, p.farm_box_total
    from picked p
    returning label_prints.box_id, label_prints.kind
  )
  select p.id, l.kind, v.id, v.width_mm, v.height_mm, v.orientation, v.layout, public.box_label_data(p.id)
  from picked p
  join logged l on l.box_id = p.id
  join label_template_versions v on v.id = p.version_id
  order by p.customer_id, p.buyer_box_no, p.id;
end;
$$;

-- Boxes with their latest print and whether that label still shows the right numbers.
create view public.box_overview with (security_invoker = true) as
select b.*,
       lp.printed_at as last_printed_at,
       lp.kind as last_print_kind,
       (lp.id is not null and (lp.buyer_box_no, lp.buyer_box_total, lp.farm_box_no, lp.farm_box_total)
          is distinct from (b.buyer_box_no, b.buyer_box_total, b.farm_box_no, b.farm_box_total)
          and b.status = 'active') as label_out_of_date
from public.boxes b
left join lateral (
  select l.* from public.label_prints l where l.box_id = b.id order by l.printed_at desc, l.id desc limit 1
) lp on true;

-- Buyer names for people who handle boxes (QC can't read the customers table: it holds
-- credit limits and contacts). Runs as the view owner, so it filters rows itself.
create view public.buyer_directory as
select c.id, c.customer_code, c.company_name
from public.customers c
where public.has_any_role(array['admin', 'consolidator', 'finance', 'qc']::public.app_role[])
   or c.id = public.my_customer_id();
grant select on public.buyer_directory to authenticated;
revoke all on public.buyer_directory from anon;

-- Packing list / proforma rows: one per farm allocation, with its boxes and prices.
create view public.order_packing_list with (security_invoker = true) as
select o.id as order_id, o.order_number, o.customer_id, o.shipment_id, o.incoterm, o.currency,
       po.id as po_id, po.po_number, f.id as farm_id, f.farm_name,
       col.id as order_line_id, col.line_no, col.notes, col.margin_per_stem,
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

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function public.require_staff(), public.renumber_boxes(uuid, uuid), public.box_label_data(bigint)
  from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'margin_for(text, uuid)',
    'create_customer_order(uuid, uuid, date, jsonb, text, text)',
    'allocate_order_line(uuid, uuid, int, uuid, int)',
    'remove_allocation(uuid)',
    'set_grower_price(uuid, numeric)',
    'send_purchase_order(uuid)',
    'respond_purchase_order(uuid, boolean, text)',
    'assign_boxes(uuid)',
    'void_box(bigint, text)',
    'receive_boxes(bigint[])',
    'set_qc_result(bigint[], boolean, text)',
    'close_shipment(uuid)',
    'print_labels(bigint[], text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
