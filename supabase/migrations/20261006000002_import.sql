-- Import log and the import_sheet() function used by the Import page.
-- The app validates every row first (dry run). import_sheet() then writes one
-- sheet in a single transaction: existing keys update, new keys insert,
-- nothing is ever deleted. It runs as the calling user, so RLS still applies.

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id),
  file_name text not null,
  sheet text not null,
  status text not null check (status in ('succeeded', 'failed')),
  rows_total int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  message text,
  created_at timestamptz not null default now()
);
create index import_runs_created_idx on public.import_runs (created_at desc);
alter table public.import_runs enable row level security;
create policy "import_runs: staff read" on public.import_runs
  for select to authenticated using (public.is_staff());
create policy "import_runs: staff log own" on public.import_runs
  for insert to authenticated with check (public.is_staff() and user_id = auth.uid());
-- No update or delete policies: the log can't be changed.

create or replace function public.import_sheet(p_sheet text, p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total int := jsonb_array_length(p_rows);
  v_ins int := 0;
  v_upd int := 0;
  v_missing text;
  v_ref record;
begin
  if not public.is_staff() then
    raise exception 'Only Admin and Consolidator users can import data.' using errcode = '42501';
  end if;
  if v_total = 0 then
    raise exception 'There are no rows to import.';
  end if;

  case p_sheet
  -- -------------------------------------------------------------------------
  when 'Lists' then
    with up as (
      insert into lookup_values (list_name, value, sort_order, active)
      select r.list_name, r.value, r.sort_order, true
      from jsonb_to_recordset(p_rows) as r (list_name text, value text, sort_order int)
      on conflict (list_name, value) do update set sort_order = excluded.sort_order, active = true
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  -- -------------------------------------------------------------------------
  when 'Farms' then
    with up as (
      insert into farms (farm_code, farm_name, country, region, address, gln, kra_pin, sales_agent_name,
                         sales_agent_email, sales_agent_phone, currency, payment_terms, active)
      select r.farm_code, r.farm_name, r.country, r.region, r.address, r.gln, r.kra_pin, r.sales_agent_name,
             r.sales_agent_email, r.sales_agent_phone, r.currency, r.payment_terms, r.active
      from jsonb_to_recordset(p_rows) as r (farm_code text, farm_name text, country text, region text, address text,
        gln text, kra_pin text, sales_agent_name text, sales_agent_email text, sales_agent_phone text,
        currency text, payment_terms text, active boolean)
      on conflict (farm_code) do update set
        farm_name = excluded.farm_name, country = excluded.country, region = excluded.region,
        address = excluded.address, gln = excluded.gln, kra_pin = excluded.kra_pin,
        sales_agent_name = excluded.sales_agent_name, sales_agent_email = excluded.sales_agent_email,
        sales_agent_phone = excluded.sales_agent_phone, currency = excluded.currency,
        payment_terms = excluded.payment_terms, active = excluded.active
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  -- -------------------------------------------------------------------------
  when 'Customers' then
    with up as (
      insert into customers (customer_code, company_name, country, city, delivery_address, gln, vat_or_tax_id,
                             contact_name, contact_email, contact_phone, currency, incoterm, payment_terms,
                             credit_limit, destination_airport, language, active)
      select r.customer_code, r.company_name, r.country, r.city, r.delivery_address, r.gln, r.vat_or_tax_id,
             r.contact_name, r.contact_email, r.contact_phone, r.currency, r.incoterm, r.payment_terms,
             r.credit_limit, r.destination_airport, coalesce(r.language, 'EN'), r.active
      from jsonb_to_recordset(p_rows) as r (customer_code text, company_name text, country text, city text,
        delivery_address text, gln text, vat_or_tax_id text, contact_name text, contact_email text,
        contact_phone text, currency text, incoterm text, payment_terms text, credit_limit numeric,
        destination_airport text, language text, active boolean)
      on conflict (customer_code) do update set
        company_name = excluded.company_name, country = excluded.country, city = excluded.city,
        delivery_address = excluded.delivery_address, gln = excluded.gln, vat_or_tax_id = excluded.vat_or_tax_id,
        contact_name = excluded.contact_name, contact_email = excluded.contact_email,
        contact_phone = excluded.contact_phone, currency = excluded.currency, incoterm = excluded.incoterm,
        payment_terms = excluded.payment_terms, credit_limit = excluded.credit_limit,
        destination_airport = excluded.destination_airport, language = excluded.language, active = excluded.active
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  -- -------------------------------------------------------------------------
  when 'BoxTypes' then
    with up as (
      insert into box_types (box_code, description, length_cm, width_cm, height_cm, tare_weight_kg, vbn_packaging_code, active)
      select r.box_code, r.description, r.length_cm, r.width_cm, r.height_cm, r.tare_weight_kg, r.vbn_packaging_code, r.active
      from jsonb_to_recordset(p_rows) as r (box_code text, description text, length_cm numeric, width_cm numeric,
        height_cm numeric, tare_weight_kg numeric, vbn_packaging_code text, active boolean)
      on conflict (box_code) do update set
        description = excluded.description, length_cm = excluded.length_cm, width_cm = excluded.width_cm,
        height_cm = excluded.height_cm, tare_weight_kg = excluded.tare_weight_kg,
        vbn_packaging_code = excluded.vbn_packaging_code, active = excluded.active
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  -- -------------------------------------------------------------------------
  when 'Products' then
    select r.default_farm_code into v_missing
    from jsonb_to_recordset(p_rows) as r (default_farm_code text)
    left join farms f on f.farm_code = r.default_farm_code
    where r.default_farm_code is not null and f.id is null limit 1;
    if v_missing is not null then
      raise exception 'default_farm_code % is not in Farms. Import Farms first.', v_missing;
    end if;

    with up as (
      insert into products (product_code, flower_type, variety, colour, floricode_product_id, vbn_code, grade,
                            stem_length_cm, head_size_cm, maturity, stems_per_bunch, default_farm_id, active)
      select r.product_code, r.flower_type, r.variety, r.colour, r.floricode_product_id, r.vbn_code, r.grade,
             r.stem_length_cm, r.head_size_cm, r.maturity, r.stems_per_bunch, f.id, r.active
      from jsonb_to_recordset(p_rows) as r (product_code text, flower_type text, variety text, colour text,
        floricode_product_id text, vbn_code text, grade text, stem_length_cm int, head_size_cm numeric,
        maturity text, stems_per_bunch int, default_farm_code text, active boolean)
      left join farms f on f.farm_code = r.default_farm_code
      on conflict (product_code) do update set
        flower_type = excluded.flower_type, variety = excluded.variety, colour = excluded.colour,
        floricode_product_id = excluded.floricode_product_id, vbn_code = excluded.vbn_code, grade = excluded.grade,
        stem_length_cm = excluded.stem_length_cm, head_size_cm = excluded.head_size_cm, maturity = excluded.maturity,
        stems_per_bunch = excluded.stems_per_bunch, default_farm_id = excluded.default_farm_id, active = excluded.active
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  -- -------------------------------------------------------------------------
  when 'PackRates' then
    select coalesce(case when p.id is null then 'product_code ' || r.product_code end,
                    'box_code ' || r.box_code) into v_missing
    from jsonb_to_recordset(p_rows) as r (product_code text, box_code text)
    left join products p on p.product_code = r.product_code
    left join box_types b on b.box_code = r.box_code
    where p.id is null or b.id is null limit 1;
    if v_missing is not null then
      raise exception '% is not in the database yet. Import it first.', v_missing;
    end if;

    with up as (
      insert into pack_rates (product_id, box_type_id, bunches_per_box, est_gross_weight_kg)
      select p.id, b.id, r.bunches_per_box, r.est_gross_weight_kg
      from jsonb_to_recordset(p_rows) as r (product_code text, box_code text, bunches_per_box int, est_gross_weight_kg numeric)
      join products p on p.product_code = r.product_code
      join box_types b on b.box_code = r.box_code
      on conflict (product_id, box_type_id) do update set
        bunches_per_box = excluded.bunches_per_box, est_gross_weight_kg = excluded.est_gross_weight_kg
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  -- -------------------------------------------------------------------------
  when 'PriceList' then
    select coalesce(case when f.id is null then 'farm_code ' || r.farm_code end,
                    'product_code ' || r.product_code) into v_missing
    from jsonb_to_recordset(p_rows) as r (farm_code text, product_code text)
    left join farms f on f.farm_code = r.farm_code
    left join products p on p.product_code = r.product_code
    where f.id is null or p.id is null limit 1;
    if v_missing is not null then
      raise exception '% is not in the database yet. Import it first.', v_missing;
    end if;

    with up as (
      insert into price_list (farm_id, product_id, currency, price_per_stem, valid_from, valid_to, min_order_stems)
      select f.id, p.id, r.currency, r.price_per_stem, r.valid_from, r.valid_to, r.min_order_stems
      from jsonb_to_recordset(p_rows) as r (farm_code text, product_code text, currency text, price_per_stem numeric,
        valid_from date, valid_to date, min_order_stems int)
      join farms f on f.farm_code = r.farm_code
      join products p on p.product_code = r.product_code
      on conflict (farm_id, product_id, valid_from) do update set
        currency = excluded.currency, price_per_stem = excluded.price_per_stem,
        valid_to = excluded.valid_to, min_order_stems = excluded.min_order_stems
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  -- -------------------------------------------------------------------------
  when 'FreightRates' then
    with up as (
      insert into freight_rates (origin_airport, destination_airport, airline_or_agent, currency, rate_per_kg,
                                 min_charge, weight_break_kg, valid_from, valid_to)
      select r.origin_airport, r.destination_airport, coalesce(r.airline_or_agent, ''), r.currency, r.rate_per_kg,
             r.min_charge, r.weight_break_kg, r.valid_from, r.valid_to
      from jsonb_to_recordset(p_rows) as r (origin_airport text, destination_airport text, airline_or_agent text,
        currency text, rate_per_kg numeric, min_charge numeric, weight_break_kg numeric, valid_from date, valid_to date)
      on conflict (origin_airport, destination_airport, airline_or_agent, valid_from) do update set
        currency = excluded.currency, rate_per_kg = excluded.rate_per_kg, min_charge = excluded.min_charge,
        weight_break_kg = excluded.weight_break_kg, valid_to = excluded.valid_to
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  -- -------------------------------------------------------------------------
  when 'PackingList' then
    if to_regclass('pg_temp._pl') is not null then drop table _pl; end if;
    create temp table _pl on commit drop as
    select r.*
    from jsonb_to_recordset(p_rows) as r (shipment_ref text, line_no int, awb text, hawb text, customer_code text,
      farm_code text, po_number text, product_code text, box_code text, boxes int, notes text);

    select coalesce(
             case when c.id is null then 'customer_code ' || l.customer_code end,
             case when f.id is null then 'farm_code ' || l.farm_code end,
             case when p.id is null then 'product_code ' || l.product_code end,
             case when b.id is null then 'box_code ' || l.box_code end,
             case when pr.id is null then 'pack rate for ' || l.product_code || ' in ' || l.box_code end)
      into v_missing
    from _pl l
    left join customers c on c.customer_code = l.customer_code
    left join farms f on f.farm_code = l.farm_code
    left join products p on p.product_code = l.product_code
    left join box_types b on b.box_code = l.box_code
    left join pack_rates pr on pr.product_id = p.id and pr.box_type_id = b.id
    where c.id is null or f.id is null or p.id is null or b.id is null or pr.id is null
    limit 1;
    if v_missing is not null then
      raise exception '% is not in the database yet. Import it first.', v_missing;
    end if;

    -- One pass per shipment: create it if new, refuse if closed, never shrink.
    for v_ref in
      select l.shipment_ref, count(*)::int as line_count, max(l.awb) as awb from _pl l group by l.shipment_ref
    loop
      insert into shipments (shipment_ref, mawb) values (v_ref.shipment_ref, v_ref.awb)
      on conflict (shipment_ref) do nothing;

      if exists (select 1 from shipments s where s.shipment_ref = v_ref.shipment_ref and s.status = 'closed') then
        raise exception 'Shipment % is closed, so its packing list can''t change.', v_ref.shipment_ref;
      end if;

      if (select count(*) from packing_list_lines pl join shipments s on s.id = pl.shipment_id
          where s.shipment_ref = v_ref.shipment_ref) > v_ref.line_count then
        raise exception 'Shipment % already has more lines than this file. Imports can''t remove lines.', v_ref.shipment_ref;
      end if;

      if v_ref.awb is not null then
        update shipments set mawb = v_ref.awb where shipment_ref = v_ref.shipment_ref and mawb is distinct from v_ref.awb;
      end if;
    end loop;

    -- Box numbers run 1..N per shipment in line order; the spreadsheet's own formulas are ignored.
    with calc as (
      select s.id as shipment_id, l.line_no, l.hawb, c.id as customer_id, f.id as farm_id, l.po_number,
             p.id as product_id, b.id as box_type_id, l.boxes, pr.bunches_per_box,
             l.boxes * pr.bunches_per_box * p.stems_per_bunch as total_stems,
             sum(l.boxes) over (partition by l.shipment_ref order by l.line_no) - l.boxes + 1 as box_from,
             sum(l.boxes) over (partition by l.shipment_ref order by l.line_no) as box_to,
             l.notes
      from _pl l
      join shipments s on s.shipment_ref = l.shipment_ref
      join customers c on c.customer_code = l.customer_code
      join farms f on f.farm_code = l.farm_code
      join products p on p.product_code = l.product_code
      join box_types b on b.box_code = l.box_code
      join pack_rates pr on pr.product_id = p.id and pr.box_type_id = b.id
    ),
    up as (
      insert into packing_list_lines (shipment_id, line_no, hawb, customer_id, farm_id, po_number, product_id,
                                      box_type_id, boxes, bunches_per_box, total_stems, box_from, box_to, notes)
      select shipment_id, line_no, hawb, customer_id, farm_id, po_number, product_id, box_type_id, boxes,
             bunches_per_box, total_stems, box_from, box_to, notes
      from calc
      on conflict (shipment_id, line_no) do update set
        hawb = excluded.hawb, customer_id = excluded.customer_id, farm_id = excluded.farm_id,
        po_number = excluded.po_number, product_id = excluded.product_id, box_type_id = excluded.box_type_id,
        boxes = excluded.boxes, bunches_per_box = excluded.bunches_per_box, total_stems = excluded.total_stems,
        box_from = excluded.box_from, box_to = excluded.box_to, notes = excluded.notes
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new), count(*) filter (where not is_new) into v_ins, v_upd from up;

  else
    raise exception 'Unknown sheet %.', p_sheet;
  end case;

  insert into import_runs (file_name, sheet, status, rows_total, inserted, updated)
  values (p_file_name, p_sheet, 'succeeded', v_total, v_ins, v_upd);

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'total', v_total);
end;
$$;

revoke execute on function public.import_sheet(text, text, jsonb) from public, anon;
grant execute on function public.import_sheet(text, text, jsonb) to authenticated;
