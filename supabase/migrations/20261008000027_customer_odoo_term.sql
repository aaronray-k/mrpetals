-- Each buyer's payment term as Odoo has it, chosen on Customers from Odoo's own payment terms. It goes on the
-- buyer's invoices, so Odoo works out the due date exactly as for invoices made in Odoo.
alter table public.customers
  add column odoo_payment_term_id int,
  add column odoo_payment_term_name text;

-- Admin, Consolidator and Finance set it (customers are otherwise edited by staff only).
create or replace function public.set_customer_odoo_term(p_customer_id uuid, p_term_id int, p_term_name text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_invoicing();
  update customers set odoo_payment_term_id = p_term_id, odoo_payment_term_name = case when p_term_id is null then null else left(p_term_name, 120) end
  where id = p_customer_id;
  if not found then raise exception 'This buyer doesn''t exist.'; end if;
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
    -- Which due date, in order: one typed on a manual invoice; else the buyer's Odoo payment term (Odoo works it
    -- out when the invoice is confirmed); else ConsolFlora's "15th of following month"; else the Odoo settings mapping.
    'due_date', coalesce(i.due_date, case when c.odoo_payment_term_id is null and i.kind = 'invoice' and not i.manual then public.term_due_date(c.payment_terms,
                  (select max((o.created_at at time zone 'Africa/Nairobi')::date) from customer_orders o where o.id = any (i.order_ids))) end),
    'payment_term_id', case
                         when i.due_date is not null then null
                         when c.odoo_payment_term_id is not null then c.odoo_payment_term_id
                         when public.term_due_date(c.payment_terms, current_date) is null then (st.payment_term_map ->> c.payment_terms)::int
                       end,
    'payment_term_name', c.odoo_payment_term_name,
    'partner', jsonb_build_object('odoo_partner_id', c.odoo_partner_id, 'name', c.company_name, 'code', c.customer_code,
      'email', c.contact_email, 'country', c.country, 'city', c.city, 'street', c.delivery_address, 'vat', c.vat_or_tax_id),
    'orders_paid', coalesce((select bool_and(o.payment_status = 'paid') from customer_orders o where o.id = any (i.order_ids)), false))
  end
  from invoices i join customers c on c.id = i.customer_id left join shipments s on s.id = i.shipment_id cross join odoo_settings st
  where i.id = p_invoice_id
$$;
