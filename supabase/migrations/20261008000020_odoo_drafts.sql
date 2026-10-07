-- Item 11, follow-up: Odoo invoices arrive as drafts and are confirmed from ConsolFlora.
-- Admin, Consolidator and Finance see each invoice as Odoo has it (with Odoo's PDF when there is one),
-- confirm it or reset it to draft without signing in to Odoo. ConsolFlora fills Odoo's own invoice
-- fields for the MAWB, the proforma numbers and the flight, and sets the buyer's payment terms.
-- The buyer is told of an invoice only once it is confirmed, and only sees confirmed ones.

-- Which Odoo fields hold what, e.g. {"mawb": "x_studio_mawb", "proforma": "x_studio_proforma_no", "flight": "x_studio_flight_no"},
-- and which Odoo payment term each of ConsolFlora's terms is, e.g. {"Net 30": 4}.
alter table public.odoo_settings
  add column field_map jsonb not null default '{}',
  add column payment_term_map jsonb not null default '{}';

alter table public.invoices
  add column posted_at timestamptz, -- first confirmed in Odoo
  add column odoo_due_date date;
update public.invoices set posted_at = coalesce(pushed_at, now()) where odoo_state = 'posted';

alter table public.odoo_sync_log drop constraint odoo_sync_log_action_check;
alter table public.odoo_sync_log add constraint odoo_sync_log_action_check check (action in ('push', 'fetch', 'test', 'confirm', 'reset', 'update'));

-- Buyers see an invoice once it is confirmed; drafts are still being prepared.
drop policy "invoices: buyer own, staff and finance" on public.invoices;
create policy "invoices: buyer own confirmed, staff and finance" on public.invoices for select to authenticated
  using ((customer_id = public.my_customer_id() and odoo_state = 'posted') or public.is_staff() or public.is_finance_or_admin());

-- Everything Odoo needs for one invoice: the buyer's business details, currency, reference, total, and the
-- flight details for Odoo's own fields. Never a farm, grower price or margin.
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
    'payment_terms', c.payment_terms, 'payment_term_id', (st.payment_term_map ->> c.payment_terms)::int,
    'partner', jsonb_build_object('odoo_partner_id', c.odoo_partner_id, 'name', c.company_name, 'code', c.customer_code,
      'email', c.contact_email, 'country', c.country, 'city', c.city, 'street', c.delivery_address, 'vat', c.vat_or_tax_id),
    'orders_paid', coalesce((select bool_and(o.payment_status = 'paid') from customer_orders o where o.id = any (i.order_ids)), false))
  end
  from invoices i join customers c on c.id = i.customer_id left join shipments s on s.id = i.shipment_id cross join odoo_settings st
  where i.id = p_invoice_id
$$;

-- Odoo's state for an invoice, from any push, fetch or action. The first time it is confirmed, the buyer hears.
create or replace function public.apply_odoo_state(p_invoice_id uuid, p_result jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare i invoices%rowtype; v_name text := nullif(nullif(p_result ->> 'name', ''), '/');
begin
  select * into i from invoices where id = p_invoice_id for update;
  update invoices set odoo_name = coalesce(v_name, odoo_name), odoo_state = coalesce(p_result ->> 'state', odoo_state),
    odoo_payment_state = coalesce(p_result ->> 'payment_state', odoo_payment_state),
    odoo_amount_due = coalesce((p_result ->> 'amount_due')::numeric, odoo_amount_due),
    odoo_due_date = coalesce(nullif(p_result ->> 'due_date', '')::date, odoo_due_date),
    posted_at = case when p_result ->> 'state' = 'posted' then coalesce(posted_at, now()) else posted_at end,
    fetched_at = now()
  where id = p_invoice_id;
  if p_result ->> 'state' = 'posted' and i.posted_at is null and i.kind = 'invoice' then
    perform public.notify('customer', 'invoice_issued', 'Invoice ' || coalesce(v_name, i.odoo_name, '') || ' for ' || i.reference,
      i.currency || ' ' || to_char(i.amount, 'FM999,999,990.00') || coalesce(', due ' || to_char(nullif(p_result ->> 'due_date', '')::date, 'DD Mon YYYY'), '') || '.',
      null, null, i.customer_id, null, jsonb_build_object('invoice_id', i.id));
  end if;
end;
$$;
revoke execute on function public.apply_odoo_state(uuid, jsonb) from public, anon, authenticated;

create or replace function public.record_odoo_push(p_invoice_id uuid, p_ok boolean, p_result jsonb default '{}', p_error text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare i invoices%rowtype;
begin
  perform public.require_invoicing();
  select * into i from invoices where id = p_invoice_id for update;
  if not found then raise exception 'This invoice doesn''t exist.'; end if;
  if p_ok then
    update invoices set status = 'pushed', attempts = attempts + 1, last_error = null, pushed_at = coalesce(pushed_at, now()),
      odoo_source = coalesce(p_result ->> 'source', odoo_source), odoo_move_id = (p_result ->> 'move_id')::int, odoo_url = p_result ->> 'url'
    where id = p_invoice_id;
    perform public.apply_odoo_state(p_invoice_id, p_result);
    if (p_result ->> 'partner_id') is not null then
      update customers set odoo_partner_id = (p_result ->> 'partner_id')::int where id = i.customer_id;
    end if;
    if i.status <> 'pushed' and p_result ->> 'state' = 'draft' then
      perform public.notify('finance', 'invoice_draft', (case when i.kind = 'invoice' then 'Draft invoice' else 'Draft credit note' end) || ' to confirm: ' || i.reference,
        (select company_name from customers where id = i.customer_id) || ', ' || i.currency || ' ' || to_char(i.amount, 'FM999,999,990.00') || '.',
        null, null, null, null, jsonb_build_object('invoice_id', i.id));
    end if;
  else
    update invoices set status = 'failed', attempts = attempts + 1, last_error = left(p_error, 500) where id = p_invoice_id;
    if i.status <> 'failed' then
      perform public.notify('staff', 'odoo_push_failed', 'Odoo didn''t take ' || i.reference, left(p_error, 200), null, null, null, null,
        jsonb_build_object('invoice_id', i.id));
    end if;
  end if;
  insert into odoo_sync_log (action, invoice_id, ok, message) values ('push', p_invoice_id, p_ok, coalesce(p_error, nullif(p_result ->> 'name', '/'), p_result ->> 'state'));
end;
$$;

-- Odoo's current state for an invoice. A paid invoice marks its orders paid (with the Odoo number as reference).
create or replace function public.record_odoo_fetch(p_invoice_id uuid, p_result jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare i invoices%rowtype; v_paid boolean := (p_result ->> 'payment_state') in ('paid', 'in_payment', 'reversed');
begin
  perform public.require_invoicing();
  select * into i from invoices where id = p_invoice_id for update;
  if not found then raise exception 'This invoice doesn''t exist.'; end if;
  perform public.apply_odoo_state(p_invoice_id, p_result);
  if i.kind = 'invoice' and v_paid and i.odoo_payment_state is distinct from p_result ->> 'payment_state' then
    update customer_orders set payment_status = 'paid', paid_at = coalesce(paid_at, now()), paid_by = coalesce(paid_by, auth.uid()),
      payment_reference = coalesce(payment_reference, 'Odoo ' || coalesce(nullif(nullif(p_result ->> 'name', ''), '/'), i.odoo_name))
    where id = any (i.order_ids) and payment_status <> 'paid';
    perform public.notify('finance', 'invoice_paid', 'Invoice ' || coalesce(nullif(nullif(p_result ->> 'name', ''), '/'), i.odoo_name) || ' paid', i.reference,
      null, null, null, null, jsonb_build_object('invoice_id', i.id));
  end if;
end;
$$;

-- Confirm, reset to draft, or refill a draft, done in Odoo by the app server; this records the outcome.
create or replace function public.record_odoo_action(p_invoice_id uuid, p_action text, p_ok boolean, p_result jsonb default '{}', p_error text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_invoicing();
  if p_action not in ('confirm', 'reset', 'update') then raise exception 'Unknown Odoo action %.', p_action; end if;
  if not exists (select 1 from invoices where id = p_invoice_id and status = 'pushed') then
    raise exception 'This invoice isn''t in Odoo yet.';
  end if;
  if p_ok then perform public.apply_odoo_state(p_invoice_id, p_result); end if;
  insert into odoo_sync_log (action, invoice_id, ok, message)
  values (p_action, p_invoice_id, p_ok, coalesce(left(p_error, 500), nullif(p_result ->> 'name', '/'), p_result ->> 'state'));
end;
$$;
