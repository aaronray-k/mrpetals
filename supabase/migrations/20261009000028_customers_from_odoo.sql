-- Buyers come from Odoo's customer list ("Import buyers from Odoo" on Customers, Admin and Consolidator).
-- Odoo has no destination airport, incoterm or ordering contact, so an imported buyer starts on FOB and Prepaid,
-- with no airport, and shows "Needs details" until the airport, contact and country are filled in.
alter table public.customers
  add column source text not null default 'app' check (source in ('app', 'odoo', 'demo')),
  alter column destination_airport drop not null;
alter table public.customers
  add column needs_details boolean generated always as (destination_airport is null or contact_name = '' or contact_email = '' or country = '') stored;

-- p_rows: [{odoo_id, name, ref, email, phone, contact_name, country, city, street, vat, currency, term_id, term_name}]
-- p_keep_ids: the rows come from the real Odoo (never keep the preview's demo Odoo ids).
-- A buyer already in ConsolFlora is matched by its Odoo id, then by code = Odoo reference, then by exact name;
-- it is linked, made active, and only its empty details are filled. Everything else is a new buyer.
create or replace function public.import_odoo_customers(p_rows jsonb, p_keep_ids boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_id uuid;
  v_code text;
  v_base text;
  v_n int;
  v_created int := 0;
  v_updated int := 0;
begin
  if not public.is_staff() then
    raise exception 'Only Admin and Consolidator bring buyers in from Odoo.' using errcode = '42501';
  end if;
  for r in
    select * from jsonb_to_recordset(p_rows) as x (odoo_id int, name text, ref text, email text, phone text, contact_name text,
      country text, city text, street text, vat text, currency text, term_id int, term_name text)
    where nullif(trim(x.name), '') is not null
  loop
    v_id := null;
    if p_keep_ids then
      select id into v_id from customers where odoo_partner_id = r.odoo_id limit 1;
    end if;
    if v_id is null and nullif(trim(r.ref), '') is not null then
      select id into v_id from customers where upper(customer_code) = upper(trim(r.ref)) limit 1;
    end if;
    if v_id is null then
      select id into v_id from customers where lower(company_name) = lower(trim(r.name)) order by active desc limit 1;
    end if;

    if v_id is not null then
      update customers c set
        odoo_partner_id = case when p_keep_ids then r.odoo_id else c.odoo_partner_id end,
        source = 'odoo',
        active = true,
        contact_name = case when c.contact_name = '' then coalesce(left(trim(r.contact_name), 120), '') else c.contact_name end,
        contact_email = case when c.contact_email = '' then coalesce(left(trim(r.email), 200), '') else c.contact_email end,
        contact_phone = coalesce(c.contact_phone, left(r.phone, 60)),
        country = case when c.country = '' then coalesce(left(r.country, 80), '') else c.country end,
        city = coalesce(c.city, left(r.city, 120)),
        delivery_address = coalesce(c.delivery_address, left(r.street, 300)),
        vat_or_tax_id = coalesce(c.vat_or_tax_id, left(r.vat, 60)),
        odoo_payment_term_id = case when p_keep_ids and c.odoo_payment_term_id is null then r.term_id else c.odoo_payment_term_id end,
        odoo_payment_term_name = case when p_keep_ids and c.odoo_payment_term_id is null then left(r.term_name, 120) else c.odoo_payment_term_name end
      where c.id = v_id;
      v_updated := v_updated + 1;
    else
      -- The code: Odoo's reference if it is free, else three letters of the name, numbered if taken.
      v_code := upper(nullif(trim(r.ref), ''));
      if v_code is null or exists (select 1 from customers where upper(customer_code) = v_code) then
        v_base := coalesce(nullif(left(upper(regexp_replace(r.name, '[^A-Za-z]', '', 'g')), 3), ''), 'CUS');
        v_code := v_base;
        v_n := 1;
        while exists (select 1 from customers where upper(customer_code) = v_code) loop
          v_n := v_n + 1;
          v_code := v_base || v_n;
        end loop;
      end if;
      insert into customers (customer_code, company_name, country, city, delivery_address, vat_or_tax_id, contact_name,
                             contact_email, contact_phone, currency, incoterm, payment_terms, credit_limit, destination_airport,
                             odoo_partner_id, odoo_payment_term_id, odoo_payment_term_name, source)
      values (v_code, left(trim(r.name), 200), coalesce(left(r.country, 80), ''), left(r.city, 120), left(r.street, 300), left(r.vat, 60),
              coalesce(left(trim(r.contact_name), 120), ''), coalesce(left(trim(r.email), 200), ''), left(r.phone, 60),
              case when exists (select 1 from lookup_values where list_name = 'Currency' and value = upper(r.currency)) then upper(r.currency) else 'USD' end,
              'FOB', 'Prepaid', null, null,
              case when p_keep_ids then r.odoo_id end,
              case when p_keep_ids then r.term_id end, case when p_keep_ids then left(r.term_name, 120) end, 'odoo');
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'updated', v_updated);
end;
$$;
revoke all on function public.import_odoo_customers(jsonb, boolean) from public, anon;
grant execute on function public.import_odoo_customers(jsonb, boolean) to authenticated;
