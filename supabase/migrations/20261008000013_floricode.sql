-- Item 7: Floricode master data.
-- Reference tables filled by a sync from the Floricode API (or the demo data on the preview), product
-- codes and features picked from them, products flagged when their codes are blocked or changed, and
-- the Floricode details carried onto box labels and their QR code.

-- ---------------------------------------------------------------------------
-- Reference tables. Only floricode_apply_sync() writes them.
-- ---------------------------------------------------------------------------
create table public.floricode_products (
  code text primary key check (code ~ '^[0-9]{1,8}$'), -- the VBN product code
  name text not null,
  latin_name text,
  product_group text,
  status text not null default 'active' check (status in ('active', 'blocked')),
  replaced_by text, -- Floricode's replacement code when this one is blocked
  synced_at timestamptz not null default now()
);

create table public.floricode_feature_types (
  code text primary key check (code ~ '^[A-Z0-9]{2,5}$'),
  name text not null,
  -- What a product field takes from this feature (null: shown, not mapped to a product field).
  product_field text unique check (product_field in ('stem_length_cm', 'head_size_cm', 'maturity', 'grade')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  synced_at timestamptz not null default now()
);

create table public.floricode_feature_values (
  feature_type text not null references public.floricode_feature_types (code),
  code text not null check (code ~ '^[A-Za-z0-9.]{1,8}$'),
  name text not null,
  numeric_value numeric,
  status text not null default 'active' check (status in ('active', 'blocked')),
  synced_at timestamptz not null default now(),
  primary key (feature_type, code)
);

create table public.floricode_packaging (
  code text primary key check (code ~ '^[0-9A-Z]{1,8}$'),
  name text not null,
  length_cm numeric, width_cm numeric, height_cm numeric,
  status text not null default 'active' check (status in ('active', 'blocked')),
  synced_at timestamptz not null default now()
);

create table public.floricode_companies (
  code text primary key check (code ~ '^[0-9A-Z]{1,10}$'),
  gln text check (gln ~ '^[0-9]{13}$'),
  name text not null,
  country text,
  kind text check (kind in ('grower', 'trader', 'buyer', 'auction', 'other')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  synced_at timestamptz not null default now()
);
create index floricode_companies_gln_idx on public.floricode_companies (gln);

-- One row per sync: when, from where, what changed.
create table public.floricode_sync_runs (
  id bigserial primary key,
  source text not null check (source in ('api', 'demo')),
  cursor text, -- where the next sync carries on from (Floricode delivers changes since the last one)
  status text not null default 'running' check (status in ('running', 'ok', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}',
  changes jsonb not null default '[]',
  message text,
  run_by uuid default auth.uid() references auth.users (id)
);

-- Products to look at again: blocked or changed codes, no code, a code Floricode doesn't know.
create table public.product_reviews (
  id bigserial primary key,
  product_id uuid not null references public.products (id),
  reason text not null check (reason in ('missing_code', 'unknown_code', 'blocked', 'changed', 'feature_blocked')),
  detail text not null,
  sync_run_id bigint references public.floricode_sync_runs (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  resolution text check (resolution in ('fixed', 'checked'))
);
create unique index product_reviews_open_idx on public.product_reviews (product_id, reason) where resolved_at is null;

-- The Floricode feature codes chosen for a product, e.g. {"S20": "070", "Q01": "A1"}.
alter table public.products add column floricode_features jsonb not null default '{}' check (jsonb_typeof(floricode_features) = 'object');

do $$
declare t text;
begin
  foreach t in array array['floricode_products', 'floricode_feature_types', 'floricode_feature_values', 'floricode_packaging']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- Codes are not secret: everyone signed in can read them (labels, the catalog, farms).
    execute format('create policy "%s: signed-in read" on public.%I for select to authenticated using (true)', t, t);
  end loop;
end $$;
alter table public.floricode_companies enable row level security;
create policy "floricode_companies: staff read" on public.floricode_companies for select to authenticated using (public.is_staff() or public.is_finance_or_admin());
alter table public.floricode_sync_runs enable row level security;
create policy "floricode_sync_runs: staff read" on public.floricode_sync_runs for select to authenticated using (public.is_staff());
alter table public.product_reviews enable row level security;
create policy "product_reviews: staff read" on public.product_reviews for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Review: which products need a look. Opens new flags and closes the ones that no longer apply.
-- ---------------------------------------------------------------------------
create or replace function public.review_products(p_run_id bigint default null, p_product_id uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_new int;
begin
  -- Close flags whose cause has gone (a "changed" flag stays until someone marks it checked).
  update product_reviews r set resolved_at = now(), resolved_by = auth.uid(), resolution = 'fixed'
  from products p
  where p.id = r.product_id and r.resolved_at is null and (p_product_id is null or p.id = p_product_id)
    and (
      (r.reason = 'missing_code' and (p.vbn_code is not null or not p.active))
      or (r.reason = 'unknown_code' and (p.vbn_code is null or exists (select 1 from floricode_products f where f.code = p.vbn_code)))
      or (r.reason = 'blocked' and not exists (select 1 from floricode_products f where f.code = p.vbn_code and f.status = 'blocked'))
      or (r.reason = 'feature_blocked' and not exists (
            select 1 from jsonb_each_text(p.floricode_features) e
            join floricode_feature_values v on v.feature_type = e.key and v.code = e.value where v.status = 'blocked'))
    );

  with flags as (
    select p.id, 'missing_code' as reason, 'Needs a VBN code.' as detail
    from products p where p.active and p.vbn_code is null
    union all
    select p.id, 'unknown_code', 'VBN code ' || p.vbn_code || ' is not in the Floricode list.'
    from products p where p.active and p.vbn_code is not null
      and exists (select 1 from floricode_products) -- only once there is a list to check against
      and not exists (select 1 from floricode_products f where f.code = p.vbn_code)
    union all
    select p.id, 'blocked', 'Floricode blocked VBN code ' || f.code || ' (' || f.name || ')'
      || coalesce('. Use ' || f.replaced_by || coalesce(' (' || (select name from floricode_products n where n.code = f.replaced_by) || ')', '') || ' instead.', '.')
    from products p join floricode_products f on f.code = p.vbn_code where p.active and f.status = 'blocked'
    union all
    select p.id, 'feature_blocked', 'Floricode blocked ' || t.name || ' "' || v.name || '".'
    from products p cross join jsonb_each_text(p.floricode_features) e
    join floricode_feature_values v on v.feature_type = e.key and v.code = e.value
    join floricode_feature_types t on t.code = v.feature_type
    where p.active and v.status = 'blocked'
    union all
    select p.id, 'changed', c ->> 'detail'
    from floricode_sync_runs r cross join jsonb_array_elements(r.changes) c
    join products p on p.vbn_code = c ->> 'code'
    where r.id = p_run_id and c ->> 'kind' = 'product' and p.active and coalesce((c ->> 'status_change')::boolean, false) = false
  )
  insert into product_reviews (product_id, reason, detail, sync_run_id)
  select distinct on (f.id, f.reason) f.id, f.reason, f.detail, p_run_id
  from flags f
  where (p_product_id is null or f.id = p_product_id)
    and not exists (select 1 from product_reviews r where r.product_id = f.id and r.reason = f.reason and r.resolved_at is null)
  order by f.id, f.reason;
  get diagnostics v_new = row_count;
  return v_new;
end;
$$;
revoke execute on function public.review_products(bigint, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sync. The app server fetches from Floricode (or the demo data) and hands the rows over here.
-- Rows are upserted; Floricode says when a code is blocked. Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.floricode_apply_sync(p_source text, p_cursor text, p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run bigint;
  v_changes jsonb := '[]';
  v_counts jsonb;
  v_flagged int;
  r jsonb;
  o record;
begin
  if not public.has_role('admin') then
    raise exception 'Only Admin users can sync Floricode.' using errcode = '42501';
  end if;
  insert into floricode_sync_runs (source, cursor) values (p_source, p_cursor) returning id into v_run;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'feature_types', '[]')) loop
    insert into floricode_feature_types (code, name, product_field, status, synced_at)
    values (r ->> 'code', r ->> 'name', r ->> 'product_field', coalesce(r ->> 'status', 'active'), now())
    on conflict (code) do update set name = excluded.name, product_field = excluded.product_field, status = excluded.status, synced_at = now();
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'feature_values', '[]')) loop
    select * into o from floricode_feature_values where feature_type = r ->> 'feature_type' and code = r ->> 'code';
    if found and o.status = 'active' and coalesce(r ->> 'status', 'active') = 'blocked' then
      v_changes := v_changes || jsonb_build_object('kind', 'feature_value', 'code', o.feature_type || ':' || o.code,
        'detail', 'Feature value ' || o.feature_type || ' ' || o.code || ' (' || o.name || ') blocked.', 'status_change', true);
    end if;
    insert into floricode_feature_values (feature_type, code, name, numeric_value, status, synced_at)
    values (r ->> 'feature_type', r ->> 'code', r ->> 'name', (r ->> 'numeric_value')::numeric, coalesce(r ->> 'status', 'active'), now())
    on conflict (feature_type, code) do update set name = excluded.name, numeric_value = excluded.numeric_value, status = excluded.status, synced_at = now();
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'products', '[]')) loop
    select * into o from floricode_products where code = r ->> 'code';
    if found then
      if o.status = 'active' and coalesce(r ->> 'status', 'active') = 'blocked' then
        v_changes := v_changes || jsonb_build_object('kind', 'product', 'code', o.code, 'status_change', true,
          'detail', 'VBN ' || o.code || ' (' || o.name || ') blocked' || coalesce(', replaced by ' || (r ->> 'replaced_by'), '') || '.');
      elsif o.name is distinct from r ->> 'name' or o.latin_name is distinct from r ->> 'latin_name' or o.product_group is distinct from r ->> 'product_group' then
        v_changes := v_changes || jsonb_build_object('kind', 'product', 'code', o.code,
          'detail', 'VBN ' || o.code || ' renamed from "' || o.name || '" to "' || (r ->> 'name') || '"'
            || case when o.product_group is distinct from r ->> 'product_group' then ' and moved to ' || coalesce(r ->> 'product_group', 'no group') else '' end || '. Check the product still matches.');
      end if;
    else
      if exists (select 1 from floricode_sync_runs where status = 'ok') then
        v_changes := v_changes || jsonb_build_object('kind', 'new_product', 'code', r ->> 'code', 'detail', 'New VBN ' || (r ->> 'code') || ' (' || (r ->> 'name') || ').');
      end if;
    end if;
    insert into floricode_products (code, name, latin_name, product_group, status, replaced_by, synced_at)
    values (r ->> 'code', r ->> 'name', r ->> 'latin_name', r ->> 'product_group', coalesce(r ->> 'status', 'active'), r ->> 'replaced_by', now())
    on conflict (code) do update set name = excluded.name, latin_name = excluded.latin_name, product_group = excluded.product_group,
      status = excluded.status, replaced_by = excluded.replaced_by, synced_at = now();
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'packaging', '[]')) loop
    insert into floricode_packaging (code, name, length_cm, width_cm, height_cm, status, synced_at)
    values (r ->> 'code', r ->> 'name', (r ->> 'length_cm')::numeric, (r ->> 'width_cm')::numeric, (r ->> 'height_cm')::numeric, coalesce(r ->> 'status', 'active'), now())
    on conflict (code) do update set name = excluded.name, length_cm = excluded.length_cm, width_cm = excluded.width_cm,
      height_cm = excluded.height_cm, status = excluded.status, synced_at = now();
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'companies', '[]')) loop
    insert into floricode_companies (code, gln, name, country, kind, status, synced_at)
    values (r ->> 'code', r ->> 'gln', r ->> 'name', r ->> 'country', r ->> 'kind', coalesce(r ->> 'status', 'active'), now())
    on conflict (code) do update set gln = excluded.gln, name = excluded.name, country = excluded.country, kind = excluded.kind,
      status = excluded.status, synced_at = now();
  end loop;

  v_counts := jsonb_build_object(
    'received', jsonb_build_object(
      'products', jsonb_array_length(coalesce(p_data -> 'products', '[]')),
      'feature_values', jsonb_array_length(coalesce(p_data -> 'feature_values', '[]')),
      'packaging', jsonb_array_length(coalesce(p_data -> 'packaging', '[]')),
      'companies', jsonb_array_length(coalesce(p_data -> 'companies', '[]'))),
    'products', (select count(*) from floricode_products),
    'feature_types', (select count(*) from floricode_feature_types),
    'feature_values', (select count(*) from floricode_feature_values),
    'packaging', (select count(*) from floricode_packaging),
    'companies', (select count(*) from floricode_companies));
  update floricode_sync_runs set status = 'ok', finished_at = now(), counts = v_counts, changes = v_changes where id = v_run;
  v_flagged := public.review_products(v_run);
  return jsonb_build_object('run_id', v_run, 'changes', jsonb_array_length(v_changes), 'flagged', v_flagged, 'counts', v_counts);
end;
$$;

-- A sync that never reached the database (no connection, bad credentials) is still logged.
create or replace function public.floricode_log_failure(p_source text, p_message text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only Admin users can sync Floricode.' using errcode = '42501';
  end if;
  insert into floricode_sync_runs (source, status, finished_at, message) values (p_source, 'failed', now(), left(p_message, 500));
end;
$$;

-- ---------------------------------------------------------------------------
-- Products: saved through one function, with codes and features checked against Floricode.
-- ---------------------------------------------------------------------------
create or replace function public.save_product(p_id uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_vbn text := nullif(btrim(coalesce(p ->> 'vbn_code', '')), '');
  v_features jsonb := coalesce(p -> 'floricode_features', '{}');
  v_old_vbn text;
  e record;
  v_val floricode_feature_values%rowtype;
  v_type floricode_feature_types%rowtype;
  v_length int := (p ->> 'stem_length_cm')::int;
  v_head numeric := (p ->> 'head_size_cm')::numeric;
  v_maturity text := nullif(btrim(coalesce(p ->> 'maturity', '')), '');
  v_grade text := nullif(btrim(coalesce(p ->> 'grade', '')), '');
begin
  perform public.require_staff();
  if p_id is not null then
    select vbn_code into v_old_vbn from products where id = p_id;
    if not found then raise exception 'This product doesn''t exist.'; end if;
  end if;
  if v_vbn is not null then
    if not exists (select 1 from floricode_products where code = v_vbn) then
      raise exception 'VBN code % is not in the Floricode list. Sync Floricode, or choose a code from the list.', v_vbn;
    end if;
    if v_vbn is distinct from v_old_vbn and exists (select 1 from floricode_products where code = v_vbn and status = 'blocked') then
      raise exception 'Floricode blocked VBN code %. Choose the replacement code.', v_vbn;
    end if;
  end if;
  if jsonb_typeof(v_features) <> 'object' then raise exception 'Features must be a list of Floricode codes.'; end if;
  -- Each feature must be a Floricode value; mapped features fill the product's own fields.
  for e in select key, value from jsonb_each_text(v_features) loop
    select * into v_val from floricode_feature_values where feature_type = e.key and code = e.value;
    if not found then raise exception 'Feature % "%" is not in the Floricode list.', e.key, e.value; end if;
    select * into v_type from floricode_feature_types where code = e.key;
    if v_val.status = 'blocked' and not exists (select 1 from products where id = p_id and floricode_features ->> e.key = e.value) then
      raise exception 'Floricode blocked % "%". Choose another value.', v_type.name, v_val.name;
    end if;
    case v_type.product_field
      when 'stem_length_cm' then v_length := v_val.numeric_value::int;
      when 'head_size_cm' then v_head := v_val.numeric_value;
      when 'maturity' then v_maturity := v_val.name;
      when 'grade' then v_grade := v_val.code;
      else null;
    end case;
  end loop;
  if v_length is null or v_length < 1 then raise exception 'Choose the stem length.'; end if;
  if v_grade is null then raise exception 'Choose the grade.'; end if;
  if coalesce((p ->> 'stems_per_bunch')::int, 0) < 1 then raise exception 'Stems per bunch must be 1 or more.'; end if;
  if length(btrim(coalesce(p ->> 'product_code', ''))) < 2 then raise exception 'Give the product a code.'; end if;
  if length(btrim(coalesce(p ->> 'variety', ''))) < 1 or length(btrim(coalesce(p ->> 'flower_type', ''))) < 1 then
    raise exception 'Give the flower and variety.';
  end if;

  if p_id is null then
    insert into products (product_code, flower_type, variety, colour, vbn_code, floricode_product_id, grade, stem_length_cm, head_size_cm,
                          maturity, stems_per_bunch, default_farm_id, active, floricode_features, updated_by)
    values (upper(btrim(p ->> 'product_code')), btrim(p ->> 'flower_type'), btrim(p ->> 'variety'), nullif(btrim(coalesce(p ->> 'colour', '')), ''),
            v_vbn, v_vbn, v_grade, v_length, v_head, v_maturity, (p ->> 'stems_per_bunch')::int, (p ->> 'default_farm_id')::uuid,
            coalesce((p ->> 'active')::boolean, true), v_features, auth.uid())
    returning id into v_id;
  else
    update products set product_code = upper(btrim(p ->> 'product_code')), flower_type = btrim(p ->> 'flower_type'), variety = btrim(p ->> 'variety'),
      colour = nullif(btrim(coalesce(p ->> 'colour', '')), ''), vbn_code = v_vbn, floricode_product_id = v_vbn, grade = v_grade,
      stem_length_cm = v_length, head_size_cm = v_head, maturity = v_maturity, stems_per_bunch = (p ->> 'stems_per_bunch')::int,
      default_farm_id = (p ->> 'default_farm_id')::uuid, active = coalesce((p ->> 'active')::boolean, true), floricode_features = v_features,
      updated_by = auth.uid()
    where id = p_id;
  end if;
  perform public.review_products(null, v_id);
  return v_id;
exception when unique_violation then
  raise exception 'Product code % is already used.', upper(btrim(p ->> 'product_code'));
end;
$$;

-- "I've looked at it": closes a changed (or any) flag on a product.
create or replace function public.resolve_product_review(p_review_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_staff();
  update product_reviews set resolved_at = now(), resolved_by = auth.uid(), resolution = 'checked'
  where id = p_review_id and resolved_at is null;
  if not found then raise exception 'This flag is already closed.'; end if;
end;
$$;

-- Box types: the Floricode packaging code.
create or replace function public.set_box_packaging_code(p_box_type_id uuid, p_code text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_staff();
  if nullif(p_code, '') is not null and not exists (select 1 from floricode_packaging where code = p_code and status = 'active') then
    raise exception 'Packaging code % is not an active Floricode code.', p_code;
  end if;
  update box_types set vbn_packaging_code = nullif(p_code, ''), updated_by = auth.uid() where id = p_box_type_id;
  if not found then raise exception 'This box type doesn''t exist.'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Box labels: Floricode name, features, packaging code and grower GLN (also used in the QR code).
-- ---------------------------------------------------------------------------
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
    'packDate', to_char(coalesce(b.received_at, now()), 'YYYY-MM-DD'),
    'floricodeName', fp.name, 'floricodeFeatures', p.floricode_features,
    'vbnPackagingCode', bt.vbn_packaging_code, 'growerGln', f.gln
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
  left join floricode_products fp on fp.code = p.vbn_code
  where b.id = p_box_id
$$;

-- ---------------------------------------------------------------------------
-- Staff dashboard: adds products flagged for review (item 6's function, plus products_to_review).
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
