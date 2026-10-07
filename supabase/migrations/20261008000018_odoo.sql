-- Item 11: invoices in Odoo.
-- ConsolFlora keeps the detail; Odoo makes the invoice. When a shipment closes, each buyer on it gets one
-- invoice for all their orders on that flight, pushed to Odoo as a single line "Cut Flowers" with the grand
-- total (flowers, fees and charges) in the buyer's currency. Claim credit notes go the same way as Odoo
-- credit notes. Odoo's invoice number, status and payments are fetched back; a paid invoice marks the
-- orders paid. No farm, grower price or margin is ever sent.

create table public.odoo_settings (
  id boolean primary key default true check (id),
  url text check (url is null or url ~ '^https://'), -- e.g. https://consolflora.odoo.com
  database text,
  login text, -- the Odoo user the API key belongs to
  enabled boolean not null default false,
  line_label text not null default 'Cut Flowers',
  last_fetch_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
insert into public.odoo_settings default values;
alter table public.odoo_settings enable row level security;
create policy "odoo_settings: staff and finance read" on public.odoo_settings for select to authenticated using (public.is_staff() or public.is_finance_or_admin());
create policy "odoo_settings: admin update" on public.odoo_settings for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

alter table public.customers add column odoo_partner_id int;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('invoice', 'credit_note')),
  customer_id uuid not null references public.customers (id),
  shipment_id uuid references public.shipments (id),
  credit_note_id uuid unique references public.credit_notes (id),
  currency text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  reference text not null, -- what Odoo shows as the invoice reference
  order_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'pushed', 'failed')),
  attempts int not null default 0,
  last_error text,
  odoo_move_id int,
  odoo_name text, -- e.g. INV/2026/00001
  odoo_state text, -- draft, posted, cancel
  odoo_payment_state text, -- not_paid, in_payment, partial, paid, reversed
  odoo_amount_due numeric(12, 2),
  odoo_url text,
  created_at timestamptz not null default now(),
  pushed_at timestamptz,
  fetched_at timestamptz
);
-- One invoice per buyer per shipment (credit notes: one per claim credit note, via credit_note_id).
create unique index invoices_one_per_buyer_flight on public.invoices (customer_id, shipment_id) where kind = 'invoice';
alter table public.invoices enable row level security;
create policy "invoices: buyer own, staff and finance" on public.invoices for select to authenticated
  using (customer_id = public.my_customer_id() or public.is_staff() or public.is_finance_or_admin());

create table public.odoo_sync_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  action text not null check (action in ('push', 'fetch', 'test')),
  invoice_id uuid references public.invoices (id) on delete cascade,
  ok boolean not null,
  message text,
  by_user uuid default auth.uid() references auth.users (id)
);
alter table public.odoo_sync_log enable row level security;
create policy "odoo_sync_log: staff and finance read" on public.odoo_sync_log for select to authenticated using (public.is_staff() or public.is_finance_or_admin());

create or replace function public.require_invoicing()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.is_staff() or public.is_finance_or_admin()) then
    raise exception 'Only Admin, Consolidator and Finance users work with invoices.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- What to invoice: one invoice per buyer per closed shipment; one credit note per claim credit note.
-- ---------------------------------------------------------------------------
create or replace function public.make_shipment_invoices(p_shipment_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  insert into invoices (kind, customer_id, shipment_id, currency, amount, reference, order_ids)
  select 'invoice', o.customer_id, o.shipment_id, o.currency, round(sum(v.value), 2),
         s.shipment_ref || ' / ' || string_agg(o.order_number, ', ' order by o.order_number), array_agg(o.id order by o.order_number)
  from customer_orders o join order_values v on v.order_id = o.id join shipments s on s.id = o.shipment_id
  where o.shipment_id = p_shipment_id and o.status = 'open'
  group by o.customer_id, o.shipment_id, o.currency, s.shipment_ref
  on conflict (customer_id, shipment_id) where kind = 'invoice' do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.make_shipment_invoices(uuid) from public, anon, authenticated;

create or replace function public.shipments_invoice()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    perform public.make_shipment_invoices(new.id);
  end if;
  return new;
end;
$$;
create trigger shipments_invoice after update of status on public.shipments for each row execute function public.shipments_invoice();

create or replace function public.credit_notes_invoice()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into invoices (kind, customer_id, shipment_id, credit_note_id, currency, amount, reference)
  select 'credit_note', new.customer_id, c.shipment_id, new.id, new.currency, new.amount,
         new.credit_note_number || ' / claim ' || c.claim_number
  from claims c where c.id = new.claim_id and new.amount > 0;
  return new;
end;
$$;
create trigger credit_notes_invoice after insert on public.credit_notes for each row execute function public.credit_notes_invoice();

-- ---------------------------------------------------------------------------
-- The app server pushes and fetches (it holds the Odoo API key); these record the results.
-- ---------------------------------------------------------------------------
-- Everything Odoo needs for one invoice: the buyer's business details, currency, reference and total.
create or replace function public.invoice_payload(p_invoice_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_staff() or public.is_finance_or_admin() then jsonb_build_object(
    'invoice_id', i.id, 'kind', i.kind, 'currency', i.currency, 'amount', i.amount, 'reference', i.reference,
    'date', coalesce(s.flight_date, current_date), 'line_label', (select line_label from odoo_settings),
    'odoo_move_id', i.odoo_move_id, 'pushed_at', i.pushed_at,
    'partner', jsonb_build_object('odoo_partner_id', c.odoo_partner_id, 'name', c.company_name, 'code', c.customer_code,
      'email', c.contact_email, 'country', c.country, 'city', c.city, 'street', c.delivery_address, 'vat', c.vat_or_tax_id),
    'orders_paid', coalesce((select bool_and(o.payment_status = 'paid') from customer_orders o where o.id = any (i.order_ids)), false))
  end
  from invoices i join customers c on c.id = i.customer_id left join shipments s on s.id = i.shipment_id
  where i.id = p_invoice_id
$$;

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
      odoo_move_id = (p_result ->> 'move_id')::int, odoo_name = p_result ->> 'name', odoo_state = p_result ->> 'state',
      odoo_payment_state = p_result ->> 'payment_state', odoo_amount_due = (p_result ->> 'amount_due')::numeric, odoo_url = p_result ->> 'url',
      fetched_at = now()
    where id = p_invoice_id;
    if (p_result ->> 'partner_id') is not null then
      update customers set odoo_partner_id = (p_result ->> 'partner_id')::int where id = i.customer_id;
    end if;
    if i.kind = 'invoice' and i.status <> 'pushed' then
      perform public.notify('customer', 'invoice_issued', 'Invoice ' || coalesce(p_result ->> 'name', '') || ' for ' || i.reference,
        i.currency || ' ' || to_char(i.amount, 'FM999,999,990.00') || '.', null, null, i.customer_id, null, jsonb_build_object('invoice_id', i.id));
    end if;
  else
    update invoices set status = 'failed', attempts = attempts + 1, last_error = left(p_error, 500) where id = p_invoice_id;
    if i.status <> 'failed' then
      perform public.notify('staff', 'odoo_push_failed', 'Odoo didn''t take ' || i.reference, left(p_error, 200), null, null, null, null,
        jsonb_build_object('invoice_id', i.id));
    end if;
  end if;
  insert into odoo_sync_log (action, invoice_id, ok, message) values ('push', p_invoice_id, p_ok, coalesce(p_error, p_result ->> 'name'));
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
  update invoices set odoo_name = coalesce(nullif(p_result ->> 'name', ''), odoo_name), odoo_state = p_result ->> 'state',
    odoo_payment_state = p_result ->> 'payment_state', odoo_amount_due = (p_result ->> 'amount_due')::numeric, fetched_at = now()
  where id = p_invoice_id;
  if i.kind = 'invoice' and v_paid and i.odoo_payment_state is distinct from p_result ->> 'payment_state' then
    update customer_orders set payment_status = 'paid', paid_at = coalesce(paid_at, now()), paid_by = coalesce(paid_by, auth.uid()),
      payment_reference = coalesce(payment_reference, 'Odoo ' || coalesce(nullif(p_result ->> 'name', ''), i.odoo_name))
    where id = any (i.order_ids) and payment_status <> 'paid';
    perform public.notify('finance', 'invoice_paid', 'Invoice ' || coalesce(nullif(p_result ->> 'name', ''), i.odoo_name) || ' paid', i.reference,
      null, null, null, null, jsonb_build_object('invoice_id', i.id));
  end if;
end;
$$;

create or replace function public.record_odoo_test(p_ok boolean, p_message text)
returns void
language sql security definer set search_path = public
as $$
  insert into odoo_sync_log (action, ok, message) select 'test', p_ok, left(p_message, 500) where public.has_role('admin')
$$;

create or replace function public.mark_odoo_fetched()
returns void
language sql security definer set search_path = public
as $$ update odoo_settings set last_fetch_at = now() where public.is_staff() or public.is_finance_or_admin() $$;

-- Invoices for shipments closed before this item: made now, waiting to be pushed.
select public.make_shipment_invoices(id) from public.shipments where status = 'closed';
-- And credit notes issued before this item.
insert into public.invoices (kind, customer_id, shipment_id, credit_note_id, currency, amount, reference)
select 'credit_note', n.customer_id, c.shipment_id, n.id, n.currency, n.amount, n.credit_note_number || ' / claim ' || c.claim_number
from public.credit_notes n join public.claims c on c.id = n.claim_id
where n.amount > 0 and not exists (select 1 from public.invoices i where i.credit_note_id = n.id);
