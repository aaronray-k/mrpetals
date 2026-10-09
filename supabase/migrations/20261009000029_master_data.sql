-- Master data from the ConsolFlora master price file ("Import master file", Admin and Consolidator).
-- Farms (with their grower, for growers farming in several places), one webshop variety per flower and name
-- (with its catalogue photo), products per variety and stem length, farm prices (price_list), and per farm and
-- product the figures the costing uses: margins, stems per box and the box's weight. Freight per kg is one
-- setting for everyone (costing_settings). Selling FOB and CIF are worked out from these, never stored.

alter table public.farms
  add column grower text,
  add column location text,
  add column altitude text,
  add column source text not null default 'app' check (source in ('app', 'master', 'demo'));
-- Farms from the master file may come without a named sales contact; their email is filled in later.
alter table public.farms alter column sales_agent_name set default '';

create table public.varieties (
  id uuid primary key default gen_random_uuid(),
  flower_type text not null,
  name text not null,
  name_key text generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))) stored,
  grade text,
  colour text,
  -- File name under /catalogue/ (a photo from the product catalogue), or null.
  photo text,
  description text,
  -- Other spellings seen in the master file, so a re-import finds this variety again.
  spellings text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (flower_type, name_key)
);
create trigger varieties_touch before update on public.varieties for each row execute function public.touch_updated();
alter table public.varieties enable row level security;
create policy "varieties: signed-in read" on public.varieties for select to authenticated using (true);
create policy "varieties: staff insert" on public.varieties for insert to authenticated with check (public.is_staff());
create policy "varieties: staff update" on public.varieties for update to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.products add column variety_id uuid references public.varieties (id);
create index products_variety_idx on public.products (variety_id);
create unique index products_variety_length on public.products (variety_id, stem_length_cm) where variety_id is not null;

-- Per farm and product: what the costing needs besides the farm price (which stays dated in price_list).
create table public.farm_offers (
  farm_id uuid not null references public.farms (id),
  product_id uuid not null references public.products (id),
  fob_margin numeric(12, 4) check (fob_margin >= 0),
  cif_margin numeric(12, 4) check (cif_margin >= 0),
  stems_per_box int check (stems_per_box >= 1),
  box_weight_kg numeric(8, 2) check (box_weight_kg > 0),
  trucking_per_box numeric(10, 2) check (trucking_per_box >= 0),
  trucking_per_stem numeric(10, 4) check (trucking_per_stem >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid(),
  primary key (farm_id, product_id)
);
create index farm_offers_product_idx on public.farm_offers (product_id);
create trigger farm_offers_touch before update on public.farm_offers for each row execute function public.touch_updated();
alter table public.farm_offers enable row level security;
-- ConsolFlora's margins: staff and Finance only, never farms or buyers.
create policy "farm_offers: staff and finance read" on public.farm_offers for select to authenticated using (public.is_staff() or public.is_finance_or_admin());
create policy "farm_offers: staff insert" on public.farm_offers for insert to authenticated with check (public.is_staff());
create policy "farm_offers: staff update" on public.farm_offers for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- One row: the figures every costing uses. Changes are logged.
create table public.costing_settings (
  id boolean primary key default true check (id),
  freight_per_kg numeric(10, 4) not null default 4.30 check (freight_per_kg >= 0),
  freight_currency text not null default 'USD',
  -- Trucking to Madrid: kept, but off (greyed out) for now.
  trucking_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
insert into public.costing_settings default values;
create table public.costing_settings_log (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) default auth.uid(),
  freight_per_kg numeric(10, 4) not null,
  freight_currency text not null,
  trucking_enabled boolean not null
);
alter table public.costing_settings enable row level security;
alter table public.costing_settings_log enable row level security;
create policy "costing_settings: staff and finance read" on public.costing_settings for select to authenticated using (public.is_staff() or public.is_finance_or_admin());
create policy "costing_settings_log: staff and finance read" on public.costing_settings_log for select to authenticated using (public.is_staff() or public.is_finance_or_admin());

create or replace function public.set_costing_settings(p_freight_per_kg numeric, p_freight_currency text, p_trucking_enabled boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Only Admin and Consolidator change the freight rate.' using errcode = '42501';
  end if;
  if p_freight_per_kg is null or p_freight_per_kg < 0 or p_freight_per_kg > 100 then
    raise exception 'The freight rate per kg must be between 0 and 100.';
  end if;
  if not exists (select 1 from lookup_values where list_name = 'Currency' and value = p_freight_currency) then
    raise exception 'Unknown currency %.', p_freight_currency;
  end if;
  update costing_settings set freight_per_kg = p_freight_per_kg, freight_currency = p_freight_currency,
    trucking_enabled = coalesce(p_trucking_enabled, false), updated_at = now(), updated_by = auth.uid();
  insert into costing_settings_log (freight_per_kg, freight_currency, trucking_enabled)
  values (p_freight_per_kg, p_freight_currency, coalesce(p_trucking_enabled, false));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- The import, in parts (the app sends farms and varieties, then prices in batches). Admin and Consolidator.
-- ---------------------------------------------------------------------------------------------------------

-- p_farms: [{name, grower, email, phone, location, altitude, currency}]. Matched by name (any case and spacing);
-- an existing farm keeps what it has and only gets empty details filled. Returns {name: id}.
create or replace function public.master_import_farms(p_farms jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_id uuid;
  v_code text;
  v_base text;
  v_n int;
  v_out jsonb := '{}';
begin
  if not public.is_staff() then
    raise exception 'Only Admin and Consolidator import the master file.' using errcode = '42501';
  end if;
  for r in select * from jsonb_to_recordset(p_farms) as x (name text, grower text, email text, phone text, location text, altitude text, currency text)
  loop
    select id into v_id from farms where lower(regexp_replace(farm_name, '\s+', ' ', 'g')) = lower(regexp_replace(trim(r.name), '\s+', ' ', 'g')) limit 1;
    if v_id is null then
      v_base := coalesce(nullif(left(upper(regexp_replace(r.name, '[^A-Za-z]', '', 'g')), 4), ''), 'FARM');
      v_code := v_base;
      v_n := 1;
      while exists (select 1 from farms where farm_code = v_code) loop
        v_n := v_n + 1;
        v_code := v_base || v_n;
      end loop;
      insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, sales_agent_phone, currency, grower, location, altitude, source)
      values (v_code, left(trim(r.name), 200), 'Kenya', '', coalesce(left(r.email, 200), ''), left(r.phone, 60),
              coalesce(r.currency, 'USD'), left(r.grower, 200), left(r.location, 200), left(r.altitude, 100), 'master')
      returning id into v_id;
    else
      update farms f set
        grower = coalesce(f.grower, left(r.grower, 200)),
        location = coalesce(f.location, left(r.location, 200)),
        altitude = coalesce(f.altitude, left(r.altitude, 100)),
        sales_agent_email = case when f.sales_agent_email = '' then coalesce(left(r.email, 200), '') else f.sales_agent_email end,
        sales_agent_phone = coalesce(f.sales_agent_phone, left(r.phone, 60)),
        active = true
      where f.id = v_id;
    end if;
    v_out := v_out || jsonb_build_object(r.name, v_id);
  end loop;
  return v_out;
end;
$$;

-- p_varieties: [{key, flower_type, name, grade, colour, photo, spellings}]. Matched by flower and name, or a
-- spelling seen before; a variety already here keeps its name, photo and description. Returns {key: id}.
create or replace function public.master_import_varieties(p_varieties jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_id uuid;
  v_out jsonb := '{}';
begin
  if not public.is_staff() then
    raise exception 'Only Admin and Consolidator import the master file.' using errcode = '42501';
  end if;
  for r in select * from jsonb_to_recordset(p_varieties) as x (key text, flower_type text, name text, grade text, colour text, photo text, spellings text[])
  loop
    select id into v_id from varieties v
    where v.flower_type = r.flower_type
      and (v.name_key = lower(regexp_replace(r.name, '[^a-zA-Z0-9]', '', 'g'))
           or exists (select 1 from unnest(r.spellings) s where lower(regexp_replace(s, '[^a-zA-Z0-9]', '', 'g')) = v.name_key or s = any (v.spellings)))
    limit 1;
    if v_id is null then
      insert into varieties (flower_type, name, grade, colour, photo, spellings)
      values (r.flower_type, left(trim(r.name), 120), left(r.grade, 60), left(r.colour, 60), left(r.photo, 200), coalesce(r.spellings, '{}'))
      returning id into v_id;
    else
      update varieties v set
        grade = coalesce(v.grade, left(r.grade, 60)),
        colour = coalesce(v.colour, left(r.colour, 60)),
        photo = coalesce(v.photo, left(r.photo, 200)),
        spellings = (select array_agg(distinct s) from unnest(v.spellings || coalesce(r.spellings, '{}')) s),
        active = true
      where v.id = v_id;
    end if;
    v_out := v_out || jsonb_build_object(r.key, v_id);
  end loop;
  return v_out;
end;
$$;

-- p_offers: [{farm_id, variety_id, length_cm, head_size_cm, currency, price, fob_margin, cif_margin, stems_per_box,
-- box_weight_kg, trucking_per_box, trucking_per_stem}]. Makes the product (variety × length) if needed, the farm
-- price from today, and the farm's costing figures. Returns how many prices were saved.
create or replace function public.master_import_offers(p_offers jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_var varieties%rowtype;
  v_product uuid;
  v_code text;
  v_base text;
  v_n int;
  v_count int := 0;
begin
  if not public.is_staff() then
    raise exception 'Only Admin and Consolidator import the master file.' using errcode = '42501';
  end if;
  for r in select * from jsonb_to_recordset(p_offers) as x (farm_id uuid, variety_id uuid, length_cm int, head_size_cm numeric, currency text, price numeric,
      fob_margin numeric, cif_margin numeric, stems_per_box int, box_weight_kg numeric, trucking_per_box numeric, trucking_per_stem numeric)
  loop
    if r.price is null or r.price <= 0 or r.length_cm is null then continue; end if;
    select * into v_var from varieties where id = r.variety_id;
    if not found then raise exception 'Variety % not found.', r.variety_id; end if;
    select id into v_product from products where variety_id = r.variety_id and stem_length_cm = r.length_cm;
    if v_product is null then
      v_base := left(upper(regexp_replace(v_var.flower_type, '[^A-Za-z]', '', 'g')), 3) || '-' || left(upper(regexp_replace(v_var.name, '[^A-Za-z0-9]', '', 'g')), 8) || '-' || r.length_cm;
      v_code := v_base;
      v_n := 1;
      while exists (select 1 from products where product_code = v_code) loop
        v_n := v_n + 1;
        v_code := v_base || '-' || v_n;
      end loop;
      insert into products (product_code, flower_type, variety, colour, grade, stem_length_cm, head_size_cm, stems_per_bunch, variety_id)
      values (v_code, v_var.flower_type, v_var.name, v_var.colour, coalesce(v_var.grade, 'Standard'), r.length_cm, r.head_size_cm,
              case when v_var.flower_type in ('Rose', 'Garden Rose') then 20 else 10 end, r.variety_id)
      returning id into v_product;
    end if;
    insert into price_list (farm_id, product_id, currency, price_per_stem, valid_from)
    values (r.farm_id, v_product, r.currency, r.price, current_date)
    on conflict (farm_id, product_id, valid_from) do update set currency = excluded.currency, price_per_stem = excluded.price_per_stem;
    insert into farm_offers (farm_id, product_id, fob_margin, cif_margin, stems_per_box, box_weight_kg, trucking_per_box, trucking_per_stem, active)
    values (r.farm_id, v_product, r.fob_margin, r.cif_margin, r.stems_per_box, r.box_weight_kg, r.trucking_per_box, r.trucking_per_stem, true)
    on conflict (farm_id, product_id) do update set fob_margin = excluded.fob_margin, cif_margin = excluded.cif_margin,
      stems_per_box = excluded.stems_per_box, box_weight_kg = excluded.box_weight_kg, trucking_per_box = excluded.trucking_per_box,
      trucking_per_stem = excluded.trucking_per_stem, active = true, updated_by = auth.uid();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.master_import_farms(jsonb), public.master_import_varieties(jsonb), public.master_import_offers(jsonb),
  public.set_costing_settings(numeric, text, boolean) from public, anon;
grant execute on function public.master_import_farms(jsonb), public.master_import_varieties(jsonb), public.master_import_offers(jsonb),
  public.set_costing_settings(numeric, text, boolean) to authenticated;
