-- Item 10: buyer claims.
--   1. The buyer reports a claim on boxes of a shipped order, within the claim window after arrival
--      (24 hours by default, Admin setting): per box the reason, stems, a note and photos, plus extra costs.
--   2. A Consolidator (or Admin) approves or denies each line. On finishing the review the buyer gets a
--      ConsolFlora credit note for what was approved, in their currency.
--   3. Approved lines go to the farm the box came from as a claim notice, at the farm's own price and
--      currency, with the photos. Farms never see the buyer or the buyer's price.
--   4. The farm responds with its credit note (number, amount, date, document), or raises a query.

alter table public.ordering_settings add column claim_window_hours int not null default 24 check (claim_window_hours between 1 and 720);
-- When the flight landed; until staff enter it, the day after the flight date at 08:00 Nairobi time.
alter table public.shipments add column arrived_at timestamptz;

create or replace function public.shipment_arrival(p_shipment_id uuid)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  select coalesce(s.arrived_at, ((s.flight_date + 1)::timestamp + time '08:00') at time zone 'Africa/Nairobi')
  from shipments s where s.id = p_shipment_id
$$;

create or replace function public.claim_deadline(p_shipment_id uuid)
returns timestamptz
language sql stable security definer set search_path = public
as $$ select public.shipment_arrival(p_shipment_id) + make_interval(hours => (select claim_window_hours from ordering_settings)) $$;

-- Numbers per document type and year: CLM-2026-00001 (claims), CN- (credit notes), FCN- (farm claim notices).
create table public.claim_counters (prefix text not null, year int not null, last_no int not null, primary key (prefix, year));
alter table public.claim_counters enable row level security;

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  claim_number text not null unique,
  customer_id uuid not null references public.customers (id),
  shipment_id uuid not null references public.shipments (id),
  currency text not null,
  status text not null default 'submitted' check (status in ('submitted', 'decided', 'withdrawn')),
  note text,
  submitted_at timestamptz not null default now(),
  submitted_by uuid default auth.uid() references auth.users (id),
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  decision_note text
);

create table public.claim_lines (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  line_no int not null,
  box_id bigint not null references public.boxes (id),
  reason text not null references public.qc_reasons (code),
  stems int not null check (stems >= 1),
  note text,
  price_per_stem numeric(12, 4) not null, -- the buyer's price for the box's flowers
  claimed_amount numeric(12, 2) not null,
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'denied')),
  approved_stems int check (approved_stems >= 0),
  approved_amount numeric(12, 2),
  decision_note text,
  unique (claim_id, line_no),
  unique (claim_id, box_id)
);

-- Extra costs the buyer had (fumigation, disposal…). Staff approve them and say which farm caused them.
create table public.claim_costs (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  description text not null check (length(btrim(description)) between 2 and 120),
  amount numeric(12, 2) not null check (amount > 0),
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'denied')),
  approved_amount numeric(12, 2),
  farm_id uuid references public.farms (id),
  decision_note text
);

-- Photos: private bucket "claim-photos", files at <claim id>/<file>.
create table public.claim_photos (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  claim_line_id uuid references public.claim_lines (id) on delete cascade,
  storage_path text not null unique,
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  uploaded_at timestamptz not null default now(),
  check (storage_path like claim_id::text || '/%')
);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_number text not null unique,
  claim_id uuid not null unique references public.claims (id),
  customer_id uuid not null references public.customers (id),
  currency text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  issued_at timestamptz not null default now(),
  issued_by uuid default auth.uid() references auth.users (id)
);

-- What a farm is asked to credit, per claim. Farm price and currency; no buyer details.
create table public.farm_claim_notices (
  id uuid primary key default gen_random_uuid(),
  notice_number text not null unique,
  claim_id uuid not null references public.claims (id),
  farm_id uuid not null references public.farms (id),
  currency text not null,
  amount numeric(12, 2) not null,
  status text not null default 'sent' check (status in ('sent', 'queried', 'credited', 'closed')),
  sent_at timestamptz not null default now(),
  credit_note_number text,
  credit_amount numeric(12, 2),
  credit_issued_on date,
  credit_document_path text,
  credited_at timestamptz,
  unique (claim_id, farm_id)
);
create table public.farm_claim_notice_lines (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.farm_claim_notices (id) on delete cascade,
  claim_line_id uuid references public.claim_lines (id),
  box_id bigint references public.boxes (id),
  po_number text,
  product text not null,
  reason text not null,
  stems int,
  price_per_stem numeric(12, 4),
  amount numeric(12, 2) not null
);
create table public.farm_claim_messages (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.farm_claim_notices (id) on delete cascade,
  author_side text not null check (author_side in ('farm', 'consolflora')),
  body text not null check (length(btrim(body)) between 2 and 2000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id)
);

-- ---------------------------------------------------------------------------
-- Who sees what. Writes only through the functions below (and photo uploads).
-- ---------------------------------------------------------------------------
alter table public.claims enable row level security;
create policy "claims: buyer own, staff" on public.claims for select to authenticated
  using (customer_id = public.my_customer_id() or public.is_staff() or public.is_qc() or public.has_role('finance'));
alter table public.claim_lines enable row level security;
create policy "claim_lines: with the claim" on public.claim_lines for select to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_id));
alter table public.claim_costs enable row level security;
create policy "claim_costs: with the claim" on public.claim_costs for select to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_id));
alter table public.credit_notes enable row level security;
create policy "credit_notes: buyer own, staff" on public.credit_notes for select to authenticated
  using (customer_id = public.my_customer_id() or public.is_staff() or public.has_role('finance'));

-- Farms see the photos of claim lines on their notices (not the claim itself).
create or replace function public.can_see_claim_photos(p_claim_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from claims c where c.id = p_claim_id
                 and (c.customer_id = public.my_customer_id() or public.is_staff() or public.is_qc() or public.has_role('finance')))
      or exists (select 1 from farm_claim_notices n where n.claim_id = p_claim_id and n.farm_id = public.my_farm_id())
$$;
alter table public.claim_photos enable row level security;
create policy "claim_photos: read" on public.claim_photos for select to authenticated
  using (public.can_see_claim_photos(claim_id)
         and (claim_line_id is null or public.is_staff() or public.is_qc() or public.has_role('finance')
              or exists (select 1 from claims c where c.id = claim_id and c.customer_id = public.my_customer_id())
              or exists (select 1 from farm_claim_notice_lines l join farm_claim_notices n on n.id = l.notice_id
                         where l.claim_line_id = claim_photos.claim_line_id and n.farm_id = public.my_farm_id())));
-- The buyer adds photos to their own claim while it is being reviewed.
create policy "claim_photos: buyer adds" on public.claim_photos for insert to authenticated
  with check (uploaded_by = auth.uid()
              and exists (select 1 from claims c where c.id = claim_id and c.customer_id = public.my_customer_id() and c.status = 'submitted')
              and (claim_line_id is null or exists (select 1 from claim_lines l where l.id = claim_line_id and l.claim_id = claim_photos.claim_id)));
revoke update, delete on public.claim_photos from authenticated, anon;

alter table public.farm_claim_notices enable row level security;
create policy "farm_claim_notices: farm own, staff" on public.farm_claim_notices for select to authenticated
  using (farm_id = public.my_farm_id() or public.is_staff() or public.has_role('finance'));
alter table public.farm_claim_notice_lines enable row level security;
create policy "farm_claim_notice_lines: with the notice" on public.farm_claim_notice_lines for select to authenticated
  using (exists (select 1 from public.farm_claim_notices n where n.id = notice_id));
alter table public.farm_claim_messages enable row level security;
create policy "farm_claim_messages: with the notice" on public.farm_claim_messages for select to authenticated
  using (exists (select 1 from public.farm_claim_notices n where n.id = notice_id));

insert into storage.buckets (id, name, public) values ('claim-photos', 'claim-photos', false) on conflict (id) do nothing;
create policy "claim-photos: buyer upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-photos'
              and exists (select 1 from public.claims c where c.id::text = (storage.foldername(name))[1]
                          and c.customer_id = public.my_customer_id() and c.status = 'submitted'));
create policy "claim-photos: read" on storage.objects for select to authenticated
  using (bucket_id = 'claim-photos' and exists (select 1 from public.claim_photos p where p.storage_path = name));
-- Farm credit note documents: "farm-credit-notes" bucket, files at <notice id>/<file>.
insert into storage.buckets (id, name, public) values ('farm-credit-notes', 'farm-credit-notes', false) on conflict (id) do nothing;
create policy "farm-credit-notes: farm upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'farm-credit-notes'
              and exists (select 1 from public.farm_claim_notices n where n.id::text = (storage.foldername(name))[1] and n.farm_id = public.my_farm_id()));
create policy "farm-credit-notes: read" on storage.objects for select to authenticated
  using (bucket_id = 'farm-credit-notes'
         and exists (select 1 from public.farm_claim_notices n where n.id::text = (storage.foldername(name))[1]
                     and (n.farm_id = public.my_farm_id() or public.is_staff() or public.has_role('finance'))));

-- ---------------------------------------------------------------------------
-- Buyer: which boxes can be claimed, and submitting a claim.
-- ---------------------------------------------------------------------------
create or replace function public.claimable_boxes()
returns table (shipment_id uuid, shipment_ref text, flight_date date, deadline timestamptz, box_id bigint, buyer_box_no int,
               order_number text, product text, stems int, price_per_stem numeric, currency text)
language sql stable security definer set search_path = public
as $$
  select s.id, s.shipment_ref, s.flight_date, public.claim_deadline(s.id), b.id, b.buyer_box_no, o.order_number,
         p.variety || ' ' || p.stem_length_cm || ' cm', b.stems,
         coalesce(ol.quoted_price_per_stem, 0), o.currency
  from boxes b
  join shipments s on s.id = b.shipment_id
  join purchase_order_lines pl on pl.id = b.po_line_id
  join customer_order_lines ol on ol.id = pl.order_line_id
  join customer_orders o on o.id = ol.order_id
  join products p on p.id = b.product_id
  where b.customer_id = public.my_customer_id() and b.status = 'active' and s.status = 'closed'
    and now() <= public.claim_deadline(s.id)
    and not exists (select 1 from claim_lines cl join claims c on c.id = cl.claim_id where cl.box_id = b.id and c.status <> 'withdrawn')
  order by s.flight_date desc, b.buyer_box_no
$$;

create or replace function public.next_claim_number(p_prefix text)
returns text
language plpgsql security definer set search_path = public
as $$
declare v int; y int := extract(year from now())::int;
begin
  insert into claim_counters (prefix, year, last_no) values (p_prefix, y, 1)
  on conflict (prefix, year) do update set last_no = claim_counters.last_no + 1 returning last_no into v;
  return p_prefix || '-' || y || '-' || lpad(v::text, 5, '0');
end;
$$;
revoke execute on function public.next_claim_number(text) from public, anon, authenticated;

create or replace function public.submit_claim(p_shipment_id uuid, p_lines jsonb, p_costs jsonb default '[]', p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_customer uuid := public.my_customer_id();
  v_claim uuid;
  v_number text;
  v_currency text;
  l record;
  b record;
  n int := 0;
begin
  if v_customer is null or not public.has_role('customer') then raise exception 'Only buyers report claims.' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one box.'; end if;
  if not exists (select 1 from shipments where id = p_shipment_id and status = 'closed') then raise exception 'Claims are for shipments that have left.'; end if;
  if now() > public.claim_deadline(p_shipment_id) then
    raise exception 'The claim window for this shipment closed on %.', to_char(public.claim_deadline(p_shipment_id) at time zone 'Africa/Nairobi', 'DD Mon YYYY HH24:MI');
  end if;
  v_number := public.next_claim_number('CLM');
  select currency into v_currency from customers where id = v_customer;
  insert into claims (claim_number, customer_id, shipment_id, currency, note)
  values (v_number, v_customer, p_shipment_id, v_currency, nullif(btrim(coalesce(p_note, '')), '')) returning id into v_claim;

  for l in select e, ord from jsonb_array_elements(p_lines) with ordinality as x (e, ord) loop
    select cb.* into b from public.claimable_boxes() cb where cb.box_id = (l.e ->> 'box_id')::bigint and cb.shipment_id = p_shipment_id;
    if not found then raise exception 'Box % is not one of your boxes on this shipment, or was already claimed.', l.e ->> 'box_id'; end if;
    if not exists (select 1 from qc_reasons where code = l.e ->> 'reason') then raise exception 'Choose a reason for box %.', b.box_id; end if;
    if coalesce((l.e ->> 'stems')::int, 0) not between 1 and b.stems then raise exception 'Box % has % stems: claim between 1 and %.', b.box_id, b.stems, b.stems; end if;
    if (l.e ->> 'reason') in ('other', 'not_to_spec') and length(btrim(coalesce(l.e ->> 'note', ''))) < 3 then
      raise exception 'Describe the problem with box %.', b.box_id;
    end if;
    n := n + 1;
    insert into claim_lines (claim_id, line_no, box_id, reason, stems, note, price_per_stem, claimed_amount)
    values (v_claim, n, b.box_id, l.e ->> 'reason', (l.e ->> 'stems')::int, nullif(btrim(coalesce(l.e ->> 'note', '')), ''),
            b.price_per_stem, round((l.e ->> 'stems')::int * b.price_per_stem, 2));
  end loop;
  insert into claim_costs (claim_id, description, amount)
  select v_claim, btrim(e ->> 'description'), (e ->> 'amount')::numeric
  from jsonb_array_elements(coalesce(p_costs, '[]')) e where coalesce((e ->> 'amount')::numeric, 0) > 0;

  perform public.notify('staff', 'claim_submitted', 'New claim ' || v_number, n || ' boxes to review.', null, null, null, null,
                        jsonb_build_object('claim_id', v_claim));
  return jsonb_build_object('claim_id', v_claim, 'claim_number', v_number,
    'lines', (select jsonb_agg(jsonb_build_object('id', id, 'box_id', box_id) order by line_no) from claim_lines where claim_id = v_claim));
end;
$$;

create or replace function public.withdraw_claim(p_claim_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update claims set status = 'withdrawn' where id = p_claim_id and customer_id = public.my_customer_id() and status = 'submitted';
  if not found then raise exception 'Only a claim still being reviewed can be withdrawn.'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Consolidator: review each line and cost, then finish.
-- ---------------------------------------------------------------------------
create or replace function public.decide_claim_line(p_line_id uuid, p_approve boolean, p_stems int default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare l claim_lines%rowtype;
begin
  perform public.require_staff();
  select cl.* into l from claim_lines cl join claims c on c.id = cl.claim_id where cl.id = p_line_id and c.status = 'submitted' for update of cl;
  if not found then raise exception 'This claim is already decided.'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give the buyer a reason for denying it.'; end if;
  if p_approve and coalesce(p_stems, l.stems) not between 1 and l.stems then raise exception 'Approve between 1 and % stems.', l.stems; end if;
  update claim_lines set
    decision = case when p_approve then 'approved' else 'denied' end,
    approved_stems = case when p_approve then coalesce(p_stems, stems) else 0 end,
    approved_amount = case when p_approve then round(coalesce(p_stems, stems) * price_per_stem, 2) else 0 end,
    decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_line_id;
end;
$$;

create or replace function public.decide_claim_cost(p_cost_id uuid, p_approve boolean, p_amount numeric default null, p_farm_id uuid default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare k claim_costs%rowtype;
begin
  perform public.require_staff();
  select cc.* into k from claim_costs cc join claims c on c.id = cc.claim_id where cc.id = p_cost_id and c.status = 'submitted' for update of cc;
  if not found then raise exception 'This claim is already decided.'; end if;
  if p_approve and coalesce(p_amount, k.amount) not between 0.01 and k.amount then raise exception 'Approve between 0.01 and %.', k.amount; end if;
  if p_approve and p_farm_id is null then raise exception 'Say which farm caused this cost, so it goes on their claim notice.'; end if;
  update claim_costs set decision = case when p_approve then 'approved' else 'denied' end,
    approved_amount = case when p_approve then coalesce(p_amount, amount) else 0 end,
    farm_id = case when p_approve then p_farm_id end, decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_cost_id;
end;
$$;

-- Finishing the review: the buyer's credit note, and a claim notice to each farm with approved lines.
create or replace function public.finish_claim_review(p_claim_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c claims%rowtype;
  v_total numeric;
  v_cn text;
  f record;
  v_notice uuid;
  v_notices int := 0;
begin
  perform public.require_staff();
  select * into c from claims where id = p_claim_id and status = 'submitted' for update;
  if not found then raise exception 'This claim is already decided.'; end if;
  if exists (select 1 from claim_lines where claim_id = p_claim_id and decision = 'pending')
     or exists (select 1 from claim_costs where claim_id = p_claim_id and decision = 'pending') then
    raise exception 'Approve or deny every box and cost first.';
  end if;
  v_total := coalesce((select sum(approved_amount) from claim_lines where claim_id = p_claim_id), 0)
           + coalesce((select sum(approved_amount) from claim_costs where claim_id = p_claim_id), 0);
  update claims set status = 'decided', decided_at = now(), decided_by = auth.uid(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_claim_id;
  if v_total > 0 then
    v_cn := public.next_claim_number('CN');
    insert into credit_notes (credit_note_number, claim_id, customer_id, currency, amount) values (v_cn, p_claim_id, c.customer_id, c.currency, v_total);
  end if;

  -- One notice per farm: approved lines at the farm's price (from the PO line), plus approved costs.
  for f in
    select distinct farm_id from (
      select b.farm_id from claim_lines l join boxes b on b.id = l.box_id where l.claim_id = p_claim_id and l.decision = 'approved'
      union select farm_id from claim_costs where claim_id = p_claim_id and decision = 'approved') x
  loop
    insert into farm_claim_notices (notice_number, claim_id, farm_id, currency, amount)
    values (public.next_claim_number('FCN'), p_claim_id, f.farm_id, (select currency from farms where id = f.farm_id), 0)
    returning id into v_notice;
    insert into farm_claim_notice_lines (notice_id, claim_line_id, box_id, po_number, product, reason, stems, price_per_stem, amount)
    select v_notice, l.id, b.id, po.po_number, p.variety || ' ' || p.stem_length_cm || ' cm', q.label || coalesce(': ' || l.note, ''),
           l.approved_stems, coalesce(pl.grower_price_per_stem, 0), round(l.approved_stems * coalesce(pl.grower_price_per_stem, 0), 2)
    from claim_lines l join boxes b on b.id = l.box_id join products p on p.id = b.product_id
    join purchase_order_lines pl on pl.id = b.po_line_id join purchase_orders po on po.id = pl.po_id
    join qc_reasons q on q.code = l.reason
    where l.claim_id = p_claim_id and l.decision = 'approved' and b.farm_id = f.farm_id;
    -- Costs are converted into the farm's currency at today's rate.
    insert into farm_claim_notice_lines (notice_id, product, reason, amount)
    select v_notice, 'Additional cost', k.description, round(k.approved_amount * coalesce(public.fx(c.currency, (select currency from farms where id = f.farm_id), current_date), 1), 2)
    from claim_costs k where k.claim_id = p_claim_id and k.decision = 'approved' and k.farm_id = f.farm_id;
    update farm_claim_notices set amount = (select coalesce(sum(amount), 0) from farm_claim_notice_lines where notice_id = v_notice) where id = v_notice;
    perform public.notify('farm', 'claim_notice', 'Claim notice ' || (select notice_number from farm_claim_notices where id = v_notice),
      'A buyer claim on your flowers was approved. Please send your credit note.', null, null, null, f.farm_id,
      jsonb_build_object('notice_id', v_notice));
    v_notices := v_notices + 1;
  end loop;

  perform public.notify('customer', 'claim_decided', 'Claim ' || c.claim_number || ' decided',
    case when v_total > 0 then 'Credit note ' || v_cn || ' for ' || c.currency || ' ' || to_char(v_total, 'FM999,999,990.00') || '.' else 'No credit this time; see the reasons.' end,
    null, null, c.customer_id, null, jsonb_build_object('claim_id', p_claim_id));
  return jsonb_build_object('credit_note', v_cn, 'amount', v_total, 'notices', v_notices);
end;
$$;

-- ---------------------------------------------------------------------------
-- Farm: respond with a credit note, or a query. ConsolFlora replies or closes.
-- ---------------------------------------------------------------------------
create or replace function public.farm_send_credit_note(p_notice_id uuid, p_number text, p_amount numeric, p_issued_on date, p_document_path text default null, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare n farm_claim_notices%rowtype;
begin
  select * into n from farm_claim_notices where id = p_notice_id and farm_id = public.my_farm_id() and public.has_role('farm') for update;
  if not found then raise exception 'This claim notice is not for your farm.' using errcode = '42501'; end if;
  if n.status in ('credited', 'closed') then raise exception 'A credit note was already sent for this notice.'; end if;
  if length(btrim(coalesce(p_number, ''))) < 2 then raise exception 'Give your credit note number.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Give the credit note amount.'; end if;
  if p_document_path is not null and p_document_path not like p_notice_id::text || '/%' then raise exception 'Upload the document to this notice.'; end if;
  update farm_claim_notices set status = 'credited', credit_note_number = btrim(p_number), credit_amount = p_amount,
    credit_issued_on = coalesce(p_issued_on, current_date), credit_document_path = p_document_path, credited_at = now()
  where id = p_notice_id;
  if length(btrim(coalesce(p_comment, ''))) >= 2 then
    insert into farm_claim_messages (notice_id, author_side, body) values (p_notice_id, 'farm', btrim(p_comment));
  end if;
  perform public.notify('staff', 'farm_credit_note', 'Credit note from ' || (select farm_name from farms where id = n.farm_id),
    n.notice_number || ': ' || btrim(p_number) || ', ' || n.currency || ' ' || to_char(p_amount, 'FM999,999,990.00')
    || case when p_amount < n.amount then ' (less than the ' || to_char(n.amount, 'FM999,999,990.00') || ' asked)' else '' end || '.',
    null, null, null, null, jsonb_build_object('notice_id', p_notice_id, 'claim_id', n.claim_id));
end;
$$;

create or replace function public.claim_notice_message(p_notice_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare n farm_claim_notices%rowtype; v_side text;
begin
  select * into n from farm_claim_notices where id = p_notice_id;
  if not found then raise exception 'This claim notice doesn''t exist.'; end if;
  if public.has_role('farm') and n.farm_id = public.my_farm_id() then v_side := 'farm';
  elsif public.is_staff() then v_side := 'consolflora';
  else raise exception 'This claim notice is not for you.' using errcode = '42501'; end if;
  insert into farm_claim_messages (notice_id, author_side, body) values (p_notice_id, v_side, btrim(coalesce(p_body, '')));
  if v_side = 'farm' then
    update farm_claim_notices set status = 'queried' where id = p_notice_id and status = 'sent';
    perform public.notify('staff', 'farm_query', 'Query on ' || n.notice_number, left(btrim(p_body), 200), null, null, null, null,
      jsonb_build_object('notice_id', p_notice_id, 'claim_id', n.claim_id));
  else
    update farm_claim_notices set status = 'sent' where id = p_notice_id and status = 'queried';
    perform public.notify('farm', 'claim_reply', 'Reply on ' || n.notice_number, left(btrim(p_body), 200), null, null, null, n.farm_id,
      jsonb_build_object('notice_id', p_notice_id));
  end if;
end;
$$;

create or replace function public.close_claim_notice(p_notice_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_staff();
  update farm_claim_notices set status = 'closed' where id = p_notice_id and status <> 'closed';
  if not found then raise exception 'This notice is already closed.'; end if;
  if length(btrim(coalesce(p_note, ''))) >= 2 then
    insert into farm_claim_messages (notice_id, author_side, body) values (p_notice_id, 'consolflora', btrim(p_note));
  end if;
end;
$$;

-- Staff can set when a flight landed (the claim window starts then).
grant update (arrived_at) on public.shipments to authenticated;
