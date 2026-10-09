-- Manual invoices: Admin, Consolidator or Finance write an invoice (or credit note) in ConsolFlora with their
-- own lines; it goes to Odoo as a draft like the shipment invoices, and is confirmed the same way.

alter table public.invoices
  add column manual boolean not null default false,
  add column lines jsonb, -- [{name, quantity, price_unit}] for manual invoices; otherwise one line with the total
  add column mawb text,
  add column proforma text,
  add column flight text,
  add column due_date date, -- chosen on a manual invoice; otherwise from the buyer's terms
  add column created_by uuid default auth.uid() references auth.users (id);

create or replace function public.create_manual_invoice(
  p_customer_id uuid, p_kind text, p_currency text, p_reference text, p_lines jsonb,
  p_mawb text default null, p_proforma text default null, p_flight text default null, p_due_date date default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_amount numeric; v_id uuid; v_bad int;
begin
  perform public.require_invoicing();
  if p_kind not in ('invoice', 'credit_note') then raise exception 'Choose invoice or credit note.'; end if;
  if not exists (select 1 from customers where id = p_customer_id and active) then raise exception 'Choose an active buyer.'; end if;
  if not exists (select 1 from lookup_values where list_name = 'Currency' and value = p_currency and active) then
    raise exception 'Currency % is not on the currency list.', p_currency;
  end if;
  if nullif(btrim(p_reference), '') is null then raise exception 'Give the invoice a reference.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'Add between 1 and 50 lines.';
  end if;
  select count(*) into v_bad from jsonb_array_elements(p_lines) l
  where nullif(btrim(l ->> 'name'), '') is null or (l ->> 'quantity')::numeric <= 0 or (l ->> 'price_unit')::numeric < 0;
  if v_bad > 0 then raise exception 'Every line needs a description, a quantity above 0 and a price of 0 or more.'; end if;
  select round(sum((l ->> 'quantity')::numeric * (l ->> 'price_unit')::numeric), 2) into v_amount from jsonb_array_elements(p_lines) l;
  if v_amount <= 0 then raise exception 'The total must be more than 0.'; end if;

  insert into invoices (kind, customer_id, currency, amount, reference, manual, lines, mawb, proforma, flight, due_date)
  values (p_kind, p_customer_id, p_currency, v_amount, left(btrim(p_reference), 200), true,
    (select jsonb_agg(jsonb_build_object('name', left(btrim(l ->> 'name'), 500), 'quantity', (l ->> 'quantity')::numeric,
       'price_unit', (l ->> 'price_unit')::numeric)) from jsonb_array_elements(p_lines) l),
    nullif(btrim(p_mawb), ''), nullif(btrim(p_proforma), ''), nullif(btrim(p_flight), ''), p_due_date)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.invoice_payload(p_invoice_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_staff() or public.is_finance_or_admin() then jsonb_build_object(
    'invoice_id', i.id, 'kind', i.kind, 'currency', i.currency, 'amount', i.amount, 'reference', i.reference,
    'date', coalesce(s.flight_date, current_date), 'line_label', st.line_label, 'lines', i.lines,
    'odoo_move_id', i.odoo_move_id, 'odoo_state', i.odoo_state, 'odoo_name', i.odoo_name, 'pushed_at', i.pushed_at, 'posted_at', i.posted_at,
    'mawb', coalesce(i.mawb, s.mawb), 'flight', coalesce(i.flight, s.flight_no),
    'proforma', coalesce(i.proforma, (select string_agg(o.order_number, ', ' order by o.order_number) from customer_orders o
                 where case when i.kind = 'invoice' then o.id = any (i.order_ids)
                            else o.customer_id = i.customer_id and o.shipment_id = i.shipment_id and o.status = 'open' end)),
    'field_map', st.field_map,
    'payment_terms', c.payment_terms,
    -- A due date ConsolFlora sets (chosen on a manual invoice, or from the buyer's terms) takes the place of an Odoo payment term.
    'due_date', coalesce(i.due_date, case when i.kind = 'invoice' and not i.manual then public.term_due_date(c.payment_terms,
                  (select max((o.created_at at time zone 'Africa/Nairobi')::date) from customer_orders o where o.id = any (i.order_ids))) end),
    'payment_term_id', case when i.due_date is null and public.term_due_date(c.payment_terms, current_date) is null then (st.payment_term_map ->> c.payment_terms)::int end,
    'partner', jsonb_build_object('odoo_partner_id', c.odoo_partner_id, 'name', c.company_name, 'code', c.customer_code,
      'email', c.contact_email, 'country', c.country, 'city', c.city, 'street', c.delivery_address, 'vat', c.vat_or_tax_id),
    'orders_paid', coalesce((select bool_and(o.payment_status = 'paid') from customer_orders o where o.id = any (i.order_ids)), false))
  end
  from invoices i join customers c on c.id = i.customer_id left join shipments s on s.id = i.shipment_id cross join odoo_settings st
  where i.id = p_invoice_id
$$;

-- Confirm or reset a document made in Odoo itself (not by ConsolFlora): only logged.
create or replace function public.record_odoo_move_action(p_move_id int, p_action text, p_ok boolean, p_message text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_invoicing();
  if p_action not in ('confirm', 'reset') then raise exception 'Unknown Odoo action %.', p_action; end if;
  insert into odoo_sync_log (action, ok, message) values (p_action, p_ok, left(coalesce(p_message, '') || ' (Odoo #' || p_move_id || ')', 500));
end;
$$;
