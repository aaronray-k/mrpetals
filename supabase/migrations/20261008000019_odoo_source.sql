-- Item 11, follow-up: the real Odoo and the preview's demo Odoo never mix.
-- Each invoice remembers which Odoo it went to; the app server only fetches (and never re-sends) invoices
-- from the Odoo it is connected to. Invoices sent to the demo Odoo before this stay demo.
alter table public.invoices add column odoo_source text check (odoo_source in ('demo', 'api'));
update public.invoices set odoo_source = 'demo' where status = 'pushed' and odoo_url like 'https://demo.odoo.example%';

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
      odoo_source = coalesce(p_result ->> 'source', odoo_source),
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

-- Go-live: invoices made before sending to Odoo was first switched on are never sent (they were done by hand,
-- or, on the preview, are demo data). Set automatically the first time an Admin switches sending on.
alter table public.odoo_settings add column send_from timestamptz;
create or replace function public.odoo_settings_go_live()
returns trigger
language plpgsql
as $$
begin
  if new.enabled and not coalesce(old.enabled, false) and new.send_from is null then
    new.send_from := now();
  end if;
  return new;
end;
$$;
create trigger odoo_settings_go_live before update on public.odoo_settings for each row execute function public.odoo_settings_go_live();
