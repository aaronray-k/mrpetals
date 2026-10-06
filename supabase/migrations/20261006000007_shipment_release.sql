-- Shipment release (item 5): export documents, payment, credit and declining orders.
--
-- Before a shipment closes (the boxes go to the airline), each buyer on it must be cleared:
--   * Prepaid buyers: every order on the shipment is marked paid (Finance or Admin).
--   * Documents: a KEPHIS phytosanitary certificate and a certificate of origin per buyer, and the
--     customs export entry for the shipment, uploaded and checked.
--   * Credit buyers: going over the credit limit only warns; Finance or Admin can decline an order.
-- Admin can close a blocked shipment anyway, with a reason that is logged.
-- Buyers are Prepaid when their payment terms are "Prepaid", otherwise Credit.

-- ---------------------------------------------------------------------------
-- Payment and declining orders
-- ---------------------------------------------------------------------------
alter table public.customer_orders drop constraint customer_orders_status_check;
alter table public.customer_orders add constraint customer_orders_status_check check (status in ('open', 'cancelled', 'declined'));
alter table public.customer_orders
  add column payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  add column paid_at timestamptz,
  add column paid_by uuid references auth.users (id),
  add column payment_reference text,
  add column decline_reason text,
  add column declined_at timestamptz,
  add column declined_by uuid references auth.users (id),
  add constraint customer_orders_declined_reason check (status <> 'declined' or length(btrim(coalesce(decline_reason, ''))) >= 3);

alter table public.purchase_orders drop constraint purchase_orders_status_check;
alter table public.purchase_orders add constraint purchase_orders_status_check check (status in ('draft', 'sent', 'confirmed', 'declined', 'cancelled'));
alter table public.purchase_orders add column cancel_reason text;

create or replace function public.is_finance_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_any_role(array['admin', 'finance']::public.app_role[])
$$;

create or replace function public.require_finance_or_admin()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_finance_or_admin() then
    raise exception 'Only Finance and Admin users can do this.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.mark_order_paid(p_order_id uuid, p_reference text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_order customer_orders%rowtype;
begin
  perform public.require_finance_or_admin();
  select * into v_order from customer_orders where id = p_order_id for update;
  if not found then raise exception 'This order doesn''t exist.'; end if;
  if v_order.status <> 'open' then raise exception 'Order % is %.', v_order.order_number, v_order.status; end if;
  update customer_orders
  set payment_status = 'paid', paid_at = now(), paid_by = auth.uid(), payment_reference = nullif(btrim(coalesce(p_reference, '')), '')
  where id = p_order_id;
end;
$$;

create or replace function public.mark_order_unpaid(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_finance_or_admin();
  update customer_orders set payment_status = 'unpaid', paid_at = null, paid_by = null, payment_reference = null where id = p_order_id;
  if not found then raise exception 'This order doesn''t exist.'; end if;
end;
$$;

-- Declines an order (e.g. over the buyer's credit limit). Its farm POs are cancelled; farms see why.
create or replace function public.decline_order(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_order customer_orders%rowtype;
begin
  perform public.require_finance_or_admin();
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for declining the order.'; end if;
  select * into v_order from customer_orders where id = p_order_id for update;
  if not found then raise exception 'This order doesn''t exist.'; end if;
  if v_order.status <> 'open' then raise exception 'Order % is already %.', v_order.order_number, v_order.status; end if;
  if exists (
    select 1 from boxes b join purchase_order_lines pl on pl.id = b.po_line_id join purchase_orders po on po.id = pl.po_id
    where po.order_id = p_order_id and b.status = 'active'
  ) then
    raise exception 'Order % already has boxes. Void them on the shipment first.', v_order.order_number;
  end if;
  update purchase_orders set status = 'cancelled', cancel_reason = 'The order was cancelled by ConsolFlora.'
  where order_id = p_order_id and status <> 'cancelled';
  update customer_orders
  set status = 'declined', decline_reason = btrim(p_reason), declined_at = now(), declined_by = auth.uid()
  where id = p_order_id;
end;
$$;

-- What an order is worth so far: allocated stems at grower price plus margin, plus other costs.
create view public.order_values with (security_invoker = true) as
select o.id as order_id, o.customer_id, o.currency, o.status, o.payment_status, o.shipment_id,
       coalesce((select sum(pl.stems * (coalesce(pl.grower_price_per_stem, 0) + coalesce(l.margin_per_stem, 0)))
                 from public.purchase_order_lines pl
                 join public.customer_order_lines l on l.id = pl.order_line_id
                 join public.purchase_orders po on po.id = pl.po_id
                 where l.order_id = o.id and po.status <> 'cancelled'), 0)
       + coalesce((select sum(c.amount) from public.order_charges c where c.order_id = o.id), 0) as value
from public.customer_orders o;

-- Each buyer's open, unpaid orders against their credit limit.
create view public.buyer_credit with (security_invoker = true) as
select c.id as customer_id, c.customer_code, c.company_name, c.currency, c.payment_terms,
       (c.payment_terms = 'Prepaid') as is_prepaid,
       c.credit_limit,
       coalesce(sum(v.value) filter (where v.status = 'open' and v.payment_status = 'unpaid'), 0) as open_value,
       (c.payment_terms <> 'Prepaid' and c.credit_limit is not null
        and coalesce(sum(v.value) filter (where v.status = 'open' and v.payment_status = 'unpaid'), 0) > c.credit_limit) as over_limit
from public.customers c
left join public.order_values v on v.customer_id = c.id
group by c.id;

-- ---------------------------------------------------------------------------
-- Export documents
-- ---------------------------------------------------------------------------
create table public.shipment_documents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id),
  customer_id uuid references public.customers (id), -- null: for the whole shipment
  doc_type text not null check (doc_type in ('phyto', 'certificate_of_origin', 'export_entry')),
  reference text, -- certificate or entry number
  storage_path text,
  status text not null default 'uploaded' check (status in ('uploaded', 'approved')),
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  uploaded_at timestamptz not null default now(),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  check ((doc_type = 'export_entry') = (customer_id is null)),
  check (storage_path is null or storage_path like shipment_id::text || '/%')
);
create unique index shipment_documents_one on public.shipment_documents (shipment_id, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), doc_type);
alter table public.shipment_documents enable row level security;
create policy "shipment_documents: read" on public.shipment_documents for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) or customer_id = public.my_customer_id());
revoke insert, update, delete on public.shipment_documents from authenticated, anon;

insert into storage.buckets (id, name, public) values ('shipment-docs', 'shipment-docs', false)
on conflict (id) do nothing;
create policy "shipment-docs: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'shipment-docs' and public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]));
create policy "shipment-docs: read" on storage.objects for select to authenticated
  using (
    bucket_id = 'shipment-docs'
    and (
      public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[])
      or exists (select 1 from public.shipment_documents d where d.storage_path = name and d.customer_id = public.my_customer_id())
    )
  );

-- Records an uploaded document (the file is uploaded first). Replaces an earlier one of the same kind.
create or replace function public.save_shipment_document(
  p_shipment_id uuid, p_customer_id uuid, p_doc_type text, p_reference text, p_storage_path text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) then
    raise exception 'Only Admin, Consolidator and Finance users can add documents.' using errcode = '42501';
  end if;
  if p_storage_path is null and length(btrim(coalesce(p_reference, ''))) = 0 then
    raise exception 'Add the file or the document number.';
  end if;
  delete from shipment_documents
  where shipment_id = p_shipment_id and customer_id is not distinct from p_customer_id and doc_type = p_doc_type;
  insert into shipment_documents (shipment_id, customer_id, doc_type, reference, storage_path)
  values (p_shipment_id, p_customer_id, p_doc_type, nullif(btrim(coalesce(p_reference, '')), ''), p_storage_path)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.approve_shipment_document(p_document_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]) then
    raise exception 'Only Admin, Consolidator and Finance users can check documents.' using errcode = '42501';
  end if;
  update shipment_documents set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_document_id;
  if not found then raise exception 'This document doesn''t exist.'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Release status and closing
-- ---------------------------------------------------------------------------
-- Per shipment and buyer (customer_id null: the whole shipment): what still blocks release, and warnings.
create view public.shipment_release with (security_invoker = true) as
with buyers as (
  select distinct o.shipment_id, o.customer_id from public.customer_orders o where o.shipment_id is not null and o.status = 'open'
),
docs as (
  select b.shipment_id, b.customer_id, t.doc_type
  from buyers b cross join (values ('phyto'), ('certificate_of_origin')) as t (doc_type)
  union all
  select s.id, null::uuid, 'export_entry' from public.shipments s
  where exists (select 1 from buyers b where b.shipment_id = s.id)
)
select d.shipment_id, d.customer_id,
       array_remove(array_agg(distinct case when sd.id is null then d.doc_type end), null) as missing_documents,
       array_remove(array_agg(distinct case when sd.status = 'uploaded' then d.doc_type end), null) as unchecked_documents,
       coalesce(bool_or(cr.is_prepaid), false) as is_prepaid,
       coalesce((select array_agg(o.order_number order by o.order_number) from public.customer_orders o
                 where o.shipment_id = d.shipment_id and o.customer_id = d.customer_id and o.status = 'open' and o.payment_status = 'unpaid'
                   and cr.is_prepaid), '{}') as unpaid_prepaid_orders,
       coalesce(bool_or(cr.over_limit), false) as over_credit_limit
from docs d
left join public.shipment_documents sd
  on sd.shipment_id = d.shipment_id and sd.customer_id is not distinct from d.customer_id and sd.doc_type = d.doc_type
left join public.buyer_credit cr on cr.customer_id = d.customer_id
group by d.shipment_id, d.customer_id, cr.is_prepaid;

create table public.shipment_overrides (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id),
  reason text not null check (length(btrim(reason)) >= 5),
  blockers text not null,
  overridden_by uuid not null default auth.uid() references auth.users (id),
  overridden_at timestamptz not null default now()
);
alter table public.shipment_overrides enable row level security;
create policy "shipment_overrides: read" on public.shipment_overrides for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance']::public.app_role[]));
revoke insert, update, delete on public.shipment_overrides from authenticated, anon;

-- Plain words for what still blocks a shipment.
create or replace function public.shipment_blockers(p_shipment_id uuid)
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(x order by x), '{}') from (
    select coalesce(c.company_name, 'Shipment') || ': ' ||
           case d when 'phyto' then 'KEPHIS phytosanitary certificate' when 'certificate_of_origin' then 'certificate of origin' else 'customs export entry' end
           || ' missing' as x
    from shipment_release r left join customers c on c.id = r.customer_id, unnest(r.missing_documents) d
    where r.shipment_id = p_shipment_id
    union all
    select coalesce(c.company_name, 'Shipment') || ': ' ||
           case d when 'phyto' then 'KEPHIS phytosanitary certificate' when 'certificate_of_origin' then 'certificate of origin' else 'customs export entry' end
           || ' not checked yet'
    from shipment_release r left join customers c on c.id = r.customer_id, unnest(r.unchecked_documents) d
    where r.shipment_id = p_shipment_id
    union all
    select c.company_name || ': prepaid order ' || o || ' not paid'
    from shipment_release r join customers c on c.id = r.customer_id, unnest(r.unpaid_prepaid_orders) o
    where r.shipment_id = p_shipment_id
  ) t
$$;

-- Closing now checks the release gate. Admin may close anyway with a logged reason.
drop function public.close_shipment(uuid);
create or replace function public.close_shipment(p_shipment_id uuid, p_override_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ref text;
  v_blockers text[];
begin
  perform public.require_staff();
  select shipment_ref into v_ref from shipments where id = p_shipment_id and status = 'open' for update;
  if not found then raise exception 'This shipment is already closed or doesn''t exist.'; end if;
  v_blockers := public.shipment_blockers(p_shipment_id);
  if cardinality(v_blockers) > 0 then
    if p_override_reason is null then
      raise exception 'Shipment % can''t close yet: %.', v_ref, array_to_string(v_blockers, '; ');
    end if;
    if not public.has_role('admin') then
      raise exception 'Only an Admin can close a shipment that is not cleared.' using errcode = '42501';
    end if;
    if length(btrim(p_override_reason)) < 5 then
      raise exception 'Give a reason for closing anyway.';
    end if;
    insert into shipment_overrides (shipment_id, reason, blockers) values (p_shipment_id, btrim(p_override_reason), array_to_string(v_blockers, '; '));
  end if;
  update shipments set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_shipment_id;
end;
$$;

revoke execute on function public.require_finance_or_admin() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'is_finance_or_admin()',
    'mark_order_paid(uuid, text)',
    'mark_order_unpaid(uuid)',
    'decline_order(uuid, text)',
    'save_shipment_document(uuid, uuid, text, text, text)',
    'approve_shipment_document(uuid)',
    'shipment_blockers(uuid)',
    'close_shipment(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
