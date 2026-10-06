-- ConsolFlora core schema: roles, profiles and master data.
-- Every table has RLS on. Master data is never deleted: active = false hides a record.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'consolidator', 'customer', 'farm', 'qc', 'finance');

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;

-- security definer so policies can call it without recursing into user_roles' own RLS.
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = _role)
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = any (_roles))
$$;

-- Admin or Consolidator: may change master data.
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_any_role(array['admin', 'consolidator']::public.app_role[])
$$;

create policy "user_roles: read own" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
create policy "user_roles: admin grants" on public.user_roles
  for insert to authenticated with check (public.has_role('admin'));
create policy "user_roles: admin revokes" on public.user_roles
  for delete to authenticated using (public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Dropdown values from the template's Lists sheet (Currency, Incoterm, PaymentTerms...).
create table public.lookup_values (
  id uuid primary key default gen_random_uuid(),
  list_name text not null,
  value text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (list_name, value)
);
create trigger lookup_values_touch before update on public.lookup_values for each row execute function public.touch_updated();
alter table public.lookup_values enable row level security;
create policy "lookup_values: signed-in read" on public.lookup_values for select to authenticated using (true);
create policy "lookup_values: staff insert" on public.lookup_values for insert to authenticated with check (public.is_staff());
create policy "lookup_values: staff update" on public.lookup_values for update to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.lookup_values (list_name, value, sort_order)
select v.list_name, l.value, l.ord
from (values
  ('Currency', array['KES', 'USD', 'EUR']),
  ('Incoterm', array['FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'EXW']),
  ('PaymentTerms', array['Prepaid', 'Net 7', 'Net 15', 'Net 30']),
  ('YesNo', array['Y', 'N']),
  ('Language', array['EN', 'NL']),
  ('Maturity', array['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4']),
  ('Country', array['Kenya', 'Netherlands', 'United Kingdom', 'Germany', 'Russia', 'United Arab Emirates', 'Japan', 'Australia', 'United States', 'Other'])
) as v (list_name, vals)
cross join lateral unnest(v.vals) with ordinality as l (value, ord);

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
create table public.farms (
  id uuid primary key default gen_random_uuid(),
  farm_code text not null unique,
  farm_name text not null,
  country text not null,
  region text,
  address text,
  gln text check (gln ~ '^[0-9]{13}$'),
  kra_pin text,
  sales_agent_name text not null,
  sales_agent_email text not null,
  sales_agent_phone text,
  currency text not null,
  payment_terms text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  company_name text not null,
  country text not null,
  city text,
  delivery_address text,
  gln text check (gln ~ '^[0-9]{13}$'),
  vat_or_tax_id text,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  currency text not null,
  incoterm text not null,
  payment_terms text not null,
  credit_limit numeric(14, 2) check (credit_limit >= 0), -- null = no credit
  destination_airport text not null check (destination_airport ~ '^[A-Z]{3}$'),
  language text not null default 'EN',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

-- Business contact details only: no ID numbers or dates of birth (see item 7).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  company_name text,
  phone text,
  show_tips boolean not null default true,
  farm_id uuid references public.farms (id),
  customer_id uuid references public.customers (id),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles: read own, staff read all" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_staff() or public.has_role('finance'));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid() or public.has_role('admin')) with check (id = auth.uid() or public.has_role('admin'));
-- Users may change their own name, phone and tips setting, but not which farm or customer they belong to.
revoke update on public.profiles from authenticated;
grant update (full_name, company_name, phone, show_tips) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'company_name');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.my_farm_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select farm_id from public.profiles where id = auth.uid() $$;

create or replace function public.my_customer_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select customer_id from public.profiles where id = auth.uid() $$;

create table public.box_types (
  id uuid primary key default gen_random_uuid(),
  box_code text not null unique,
  description text,
  length_cm numeric(8, 2) not null check (length_cm > 0),
  width_cm numeric(8, 2) not null check (width_cm > 0),
  height_cm numeric(8, 2) not null check (height_cm > 0),
  tare_weight_kg numeric(8, 3) check (tare_weight_kg >= 0),
  volumetric_kg numeric(10, 2) generated always as (round(length_cm * width_cm * height_cm / 6000, 2)) stored,
  vbn_packaging_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,
  flower_type text not null,
  variety text not null,
  colour text,
  floricode_product_id text,
  vbn_code text,
  grade text not null,
  stem_length_cm int not null check (stem_length_cm >= 1),
  head_size_cm numeric(6, 2) check (head_size_cm >= 0),
  maturity text,
  stems_per_bunch int not null check (stems_per_bunch >= 1),
  default_farm_id uuid references public.farms (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table public.pack_rates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  box_type_id uuid not null references public.box_types (id),
  bunches_per_box int not null check (bunches_per_box >= 1),
  est_gross_weight_kg numeric(8, 3) check (est_gross_weight_kg >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (product_id, box_type_id)
);

create table public.price_list (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  product_id uuid not null references public.products (id),
  currency text not null,
  price_per_stem numeric(12, 4) not null check (price_per_stem >= 0),
  valid_from date not null,
  valid_to date check (valid_to is null or valid_to >= valid_from),
  min_order_stems int check (min_order_stems >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (farm_id, product_id, valid_from)
);

create table public.freight_rates (
  id uuid primary key default gen_random_uuid(),
  origin_airport text not null check (origin_airport ~ '^[A-Z]{3}$'),
  destination_airport text not null check (destination_airport ~ '^[A-Z]{3}$'),
  airline_or_agent text not null default '', -- '' rather than null so it can be part of the unique key
  currency text not null,
  rate_per_kg numeric(10, 4) not null check (rate_per_kg >= 0),
  min_charge numeric(12, 2) check (min_charge >= 0),
  weight_break_kg numeric(10, 2) check (weight_break_kg >= 0),
  valid_from date not null,
  valid_to date check (valid_to is null or valid_to >= valid_from),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (origin_airport, destination_airport, airline_or_agent, valid_from)
);

-- ---------------------------------------------------------------------------
-- Shipments and packing lists (box numbering arrives in item 3)
-- ---------------------------------------------------------------------------
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_ref text not null unique,
  mawb text,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table public.packing_list_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id),
  line_no int not null check (line_no >= 1),
  hawb text,
  customer_id uuid not null references public.customers (id),
  farm_id uuid not null references public.farms (id),
  po_number text,
  product_id uuid not null references public.products (id),
  box_type_id uuid not null references public.box_types (id),
  boxes int not null check (boxes >= 1),
  bunches_per_box int not null check (bunches_per_box >= 1),
  total_stems int not null,
  box_from int not null,
  box_to int not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (shipment_id, line_no)
);
create index packing_list_lines_farm_idx on public.packing_list_lines (farm_id);
create index packing_list_lines_customer_idx on public.packing_list_lines (customer_id);

-- ---------------------------------------------------------------------------
-- Triggers and RLS for master data
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['farms', 'customers', 'box_types', 'products', 'pack_rates', 'price_list', 'freight_rates', 'shipments', 'packing_list_lines']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    -- Staff write everything. There are no delete policies: nothing is deleted.
    execute format('create policy "%s: staff insert" on public.%I for insert to authenticated with check (public.is_staff())', t, t);
    execute format('create policy "%s: staff update" on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t, t);
  end loop;
end $$;

create policy "farms: read" on public.farms for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance', 'qc']::public.app_role[]) or id = public.my_farm_id());

create policy "customers: read" on public.customers for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) or id = public.my_customer_id());

create policy "products: signed-in read" on public.products for select to authenticated using (true);
create policy "box_types: signed-in read" on public.box_types for select to authenticated using (true);
create policy "pack_rates: signed-in read" on public.pack_rates for select to authenticated using (true);

create policy "price_list: read" on public.price_list for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) or farm_id = public.my_farm_id());

create policy "freight_rates: read" on public.freight_rates for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]));

create policy "packing_list_lines: read" on public.packing_list_lines for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance', 'qc']::public.app_role[])
    or farm_id = public.my_farm_id()
    or customer_id = public.my_customer_id()
  );

create policy "shipments: read" on public.shipments for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance', 'qc']::public.app_role[])
    or exists (
      select 1 from public.packing_list_lines l
      where l.shipment_id = shipments.id
        and (l.farm_id = public.my_farm_id() or l.customer_id = public.my_customer_id())
    )
  );
