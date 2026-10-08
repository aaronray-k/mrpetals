-- Payment term "15th of following month": everything for orders placed in a month is due on the 15th of the
-- next month. Some buyers pay ConsolFlora this way; most suppliers are paid this way, so new suppliers start on it.
-- For buyers ConsolFlora sets the due date on the Odoo invoice itself: the 15th of the month after the latest
-- order on the invoice was placed (Nairobi time), whatever day the invoice is confirmed.

insert into public.lookup_values (list_name, value, sort_order)
values ('PaymentTerms', '15th of following month', 5)
on conflict (list_name, value) do update set active = true;

-- New suppliers default to it, also when the Farms sheet leaves the column empty; an empty cell on an existing
-- supplier keeps what it has.
alter table public.farms alter column payment_terms set default '15th of following month';
create or replace function public.farms_payment_terms_default()
returns trigger
language plpgsql
as $$
begin
  if nullif(btrim(new.payment_terms), '') is null then
    new.payment_terms := case when tg_op = 'UPDATE' then old.payment_terms else '15th of following month' end;
  end if;
  return new;
end;
$$;
create trigger farms_payment_terms_default before insert or update of payment_terms on public.farms
  for each row execute function public.farms_payment_terms_default();

-- The due date a term gives for something placed on p_placed; null when Odoo's own payment term decides.
create or replace function public.term_due_date(p_terms text, p_placed date)
returns date
language sql immutable
as $$
  select case when p_terms = '15th of following month' then (date_trunc('month', p_placed) + interval '1 month 14 days')::date end
$$;

create or replace function public.invoice_payload(p_invoice_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_staff() or public.is_finance_or_admin() then jsonb_build_object(
    'invoice_id', i.id, 'kind', i.kind, 'currency', i.currency, 'amount', i.amount, 'reference', i.reference,
    'date', coalesce(s.flight_date, current_date), 'line_label', st.line_label,
    'odoo_move_id', i.odoo_move_id, 'odoo_state', i.odoo_state, 'odoo_name', i.odoo_name, 'pushed_at', i.pushed_at, 'posted_at', i.posted_at,
    'mawb', s.mawb, 'flight', s.flight_no,
    'proforma', (select string_agg(o.order_number, ', ' order by o.order_number) from customer_orders o
                 where case when i.kind = 'invoice' then o.id = any (i.order_ids)
                            else o.customer_id = i.customer_id and o.shipment_id = i.shipment_id and o.status = 'open' end),
    'field_map', st.field_map,
    'payment_terms', c.payment_terms,
    -- A due date ConsolFlora sets (invoices only) takes the place of an Odoo payment term.
    'due_date', case when i.kind = 'invoice' then public.term_due_date(c.payment_terms,
                  (select max((o.created_at at time zone 'Africa/Nairobi')::date) from customer_orders o where o.id = any (i.order_ids))) end,
    'payment_term_id', case when public.term_due_date(c.payment_terms, current_date) is null then (st.payment_term_map ->> c.payment_terms)::int end,
    'partner', jsonb_build_object('odoo_partner_id', c.odoo_partner_id, 'name', c.company_name, 'code', c.customer_code,
      'email', c.contact_email, 'country', c.country, 'city', c.city, 'street', c.delivery_address, 'vat', c.vat_or_tax_id),
    'orders_paid', coalesce((select bool_and(o.payment_status = 'paid') from customer_orders o where o.id = any (i.order_ids)), false))
  end
  from invoices i join customers c on c.id = i.customer_id left join shipments s on s.id = i.shipment_id cross join odoo_settings st
  where i.id = p_invoice_id
$$;
