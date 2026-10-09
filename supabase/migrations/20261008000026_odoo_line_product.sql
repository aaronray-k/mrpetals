-- The Odoo product on every invoice and credit note line ("Cut Flowers", made by ConsolFlora in Odoo once).
-- Kenya's eTIMS needs a product on each line; its KRA item code and taxes are set on the product in Odoo.
alter table public.odoo_settings
  add column line_product_id int,
  add column line_product_name text;

-- Kept by the app server after it finds or makes the product in Odoo (Admin, Consolidator, Finance push invoices).
create or replace function public.set_odoo_line_product(p_id int, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_invoicing();
  update odoo_settings set line_product_id = p_id, line_product_name = left(p_name, 200);
end;
$$;

create or replace function public.invoice_payload(p_invoice_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_staff() or public.is_finance_or_admin() then jsonb_build_object(
    'invoice_id', i.id, 'kind', i.kind, 'currency', i.currency, 'amount', i.amount, 'reference', i.reference,
    'date', coalesce(s.flight_date, current_date), 'line_label', st.line_label, 'lines', i.lines,
    'line_product_id', st.line_product_id,
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
