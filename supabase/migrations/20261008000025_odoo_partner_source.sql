-- An Odoo customer id from the preview's demo Odoo must never be used with the real Odoo.
-- Ids that only ever came from the demo Odoo are cleared; from now on only the real Odoo's ids are kept.
update public.customers c set odoo_partner_id = null
where odoo_partner_id is not null
  and not exists (select 1 from public.invoices i where i.customer_id = c.id and i.odoo_source = 'api');

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
    -- The demo Odoo's customer ids mean nothing in the real Odoo: keep only real ones.
    if (p_result ->> 'partner_id') is not null and coalesce(p_result ->> 'source', 'api') <> 'demo' then
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
