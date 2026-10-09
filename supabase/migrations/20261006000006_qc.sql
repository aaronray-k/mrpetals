-- QC scanning (item 4).
--
-- QC scans each box's QR code at ConsolFlora: the scan marks the box received and ticks it on the
-- packing list. QC then records a result:
--   pass      ready for its label
--   minor     passes, with reasons and a note
--   major     fails; can be fixed at ConsolFlora and checked again. Only Senior QC or Admin clear it.
--   critical  BACK TO FARM: the box leaves the shipment (later boxes move up a number while the
--             shipment is open) and a BACK TO FARM sticker is printed for it.
-- Reasons come from the Pacific Floral Japan quality and claim policy (sections 4 and 7).
-- Every scan and result is logged in qc_events with an id made on the phone, so a scan sent twice
-- after a lost connection is recorded once.

-- ---------------------------------------------------------------------------
-- Reasons
-- ---------------------------------------------------------------------------
create table public.qc_reasons (
  code text primary key,
  label text not null,
  -- Always Critical (BACK TO FARM). Japan has zero tolerance for pests.
  critical_only boolean not null default false,
  needs_note boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true
);
insert into public.qc_reasons (code, label, critical_only, needs_note, sort_order) values
  ('pests', 'Pests or insects', true, false, 10),
  ('disease', 'Disease or fungal infection', false, false, 20),
  ('botrytis', 'Botrytis', false, false, 30),
  ('damage', 'Physical or mechanical damage', false, false, 40),
  ('wrong_variety', 'Wrong variety', false, false, 50),
  ('wrong_length', 'Wrong stem length', false, false, 60),
  ('wrong_quantity', 'Wrong quantity', false, false, 70),
  ('wrong_grading', 'Wrong grading (not A1)', false, false, 80),
  ('bud_development', 'Poor flower or bud development', false, false, 90),
  ('too_open', 'Too many open flowers', false, false, 100),
  ('immature', 'Immature flowers', false, false, 110),
  ('colour', 'Colour not to specification', false, false, 120),
  ('uniformity', 'Not uniform', false, false, 130),
  ('foliage', 'Poor foliage', false, false, 140),
  ('post_harvest', 'Poor post-harvest condition', false, false, 150),
  ('stem_quality', 'Weak or thin stems', false, false, 160),
  ('packaging', 'Poor packaging or sleeving', false, false, 170),
  ('labelling', 'Wrong labelling', false, false, 180),
  ('cleanliness', 'Not clean', false, false, 190),
  ('not_to_spec', 'Not to the order specification', false, true, 200),
  ('other', 'Other', false, true, 999);
alter table public.qc_reasons enable row level security;
create policy "qc_reasons: signed-in read" on public.qc_reasons for select to authenticated using (true);
revoke insert, update, delete on public.qc_reasons from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Boxes: severity, reasons, BACK TO FARM
-- ---------------------------------------------------------------------------
alter table public.boxes drop constraint boxes_status_check;
alter table public.boxes add constraint boxes_status_check check (status in ('active', 'void', 'back_to_farm'));
-- Failures now carry reasons; a note is only needed for some reasons.
alter table public.boxes drop constraint boxes_check1;
alter table public.boxes
  add column qc_severity text check (qc_severity in ('minor', 'major', 'critical')),
  add column qc_reasons text[] not null default '{}';
alter table public.boxes add constraint boxes_qc_result_check check (
  (qc_status = 'pending' and qc_severity is null)
  or (qc_status = 'passed' and coalesce(qc_severity, 'minor') = 'minor')
  or (qc_status = 'failed' and qc_severity in ('major', 'critical'))
);

create or replace function public.is_qc()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_any_role(array['admin', 'consolidator', 'qc', 'senior_qc']::public.app_role[])
$$;

-- ---------------------------------------------------------------------------
-- Scan and result log
-- ---------------------------------------------------------------------------
create table public.qc_events (
  id uuid not null, -- made on the phone; one id per scan or result (a result can cover several boxes)
  box_id bigint not null references public.boxes (id),
  kind text not null check (kind in ('scan', 'result')),
  result text check (result in ('pass', 'minor', 'major', 'critical')),
  reasons text[] not null default '{}',
  note text,
  happened_at timestamptz not null, -- on the phone
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null default auth.uid() references auth.users (id),
  primary key (id, box_id),
  check ((kind = 'scan') = (result is null))
);
create index qc_events_box_idx on public.qc_events (box_id);
alter table public.qc_events enable row level security;
create policy "qc_events: read" on public.qc_events for select to authenticated
  using (public.is_qc() or public.has_role('finance'));
revoke insert, update, delete on public.qc_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Photos (evidence for claims). Files live in the private "qc-photos" bucket as <box id>/<file>.
-- ---------------------------------------------------------------------------
create table public.qc_photos (
  id uuid primary key default gen_random_uuid(),
  box_id bigint not null references public.boxes (id),
  storage_path text not null unique,
  taken_by uuid not null default auth.uid() references auth.users (id),
  taken_at timestamptz not null default now(),
  check (storage_path like box_id::text || '/%')
);
create index qc_photos_box_idx on public.qc_photos (box_id);
alter table public.qc_photos enable row level security;
create policy "qc_photos: read" on public.qc_photos for select to authenticated
  using (
    public.is_qc() or public.has_role('finance')
    or exists (select 1 from public.boxes b where b.id = box_id and b.farm_id = public.my_farm_id())
  );
create policy "qc_photos: QC add own" on public.qc_photos for insert to authenticated
  with check (public.is_qc() and taken_by = auth.uid());
revoke update, delete on public.qc_photos from authenticated, anon;

insert into storage.buckets (id, name, public) values ('qc-photos', 'qc-photos', false)
on conflict (id) do nothing;
create policy "qc-photos: QC upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'qc-photos' and public.is_qc());
create policy "qc-photos: read" on storage.objects for select to authenticated
  using (
    bucket_id = 'qc-photos'
    and (
      public.is_qc() or public.has_role('finance')
      or exists (select 1 from public.boxes b where b.id::text = (storage.foldername(name))[1] and b.farm_id = public.my_farm_id())
    )
  );

-- BACK TO FARM stickers printed (reprints allowed; each one logged).
create table public.back_to_farm_stickers (
  id uuid primary key default gen_random_uuid(),
  box_id bigint not null references public.boxes (id),
  printed_by uuid not null default auth.uid() references auth.users (id),
  printed_at timestamptz not null default now()
);
alter table public.back_to_farm_stickers enable row level security;
create policy "back_to_farm_stickers: read" on public.back_to_farm_stickers for select to authenticated using (public.is_qc());
revoke insert, update, delete on public.back_to_farm_stickers from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
-- Boxes sent back to the farm lose their number, like void boxes.
create or replace function public.renumber_boxes(p_shipment_id uuid, p_customer_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from shipments where id = p_shipment_id and status = 'closed') then
    return;
  end if;
  with numbered as (
    select id,
           row_number() over (order by id) as n,
           count(*) over () as total,
           row_number() over (partition by farm_id order by id) as fn,
           count(*) over (partition by farm_id) as ftotal
    from boxes
    where shipment_id = p_shipment_id and customer_id = p_customer_id and status = 'active'
  )
  update boxes b
  set buyer_box_no = x.n, buyer_box_total = x.total, farm_box_no = x.fn, farm_box_total = x.ftotal
  from numbered x
  where x.id = b.id
    and (b.buyer_box_no, b.buyer_box_total, b.farm_box_no, b.farm_box_total) is distinct from (x.n::int, x.total::int, x.fn::int, x.ftotal::int);

  update boxes
  set buyer_box_no = null, buyer_box_total = null, farm_box_no = null, farm_box_total = null
  where shipment_id = p_shipment_id and customer_id = p_customer_id and status <> 'active' and buyer_box_no is not null;
end;
$$;

create or replace function public.require_qc()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_qc() then
    raise exception 'Only QC, Admin and Consolidator users can record QC results.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.qc_box_summary(p_box_id bigint)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'box_id', b.id, 'status', b.status, 'void_reason', b.void_reason,
    'shipment_id', b.shipment_id, 'shipment_ref', s.shipment_ref,
    'buyer_box_no', b.buyer_box_no, 'buyer_box_total', b.buyer_box_total,
    'farm_box_no', b.farm_box_no, 'farm_box_total', b.farm_box_total,
    'customer_name', c.company_name, 'customer_code', c.customer_code, 'farm_name', f.farm_name,
    'variety', p.variety, 'flower_type', p.flower_type, 'stem_length_cm', p.stem_length_cm, 'grade', p.grade,
    'stems', b.stems, 'received_at', b.received_at,
    'qc_status', b.qc_status, 'qc_severity', b.qc_severity, 'qc_reasons', to_jsonb(b.qc_reasons), 'qc_note', b.qc_note
  )
  from boxes b
  join shipments s on s.id = b.shipment_id
  join customers c on c.id = b.customer_id
  join farms f on f.id = b.farm_id
  join products p on p.id = b.product_id
  where b.id = p_box_id
$$;

-- A scan at QC: checks the box belongs to the shipment being checked, marks it received and logs
-- the scan. Returns the box, and whether it had been scanned before.
create or replace function public.qc_scan(p_event_id uuid, p_shipment_id uuid, p_box_id bigint, p_scanned_at timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_box boxes%rowtype;
  v_ref text;
  v_before qc_events%rowtype;
  v_repeat boolean;
begin
  perform public.require_qc();
  select * into v_box from boxes where id = p_box_id for update;
  if not found then
    raise exception 'Box % is not in ConsolFlora''s records. Check the label.', p_box_id;
  end if;
  if v_box.shipment_id <> p_shipment_id then
    select shipment_ref into v_ref from shipments where id = v_box.shipment_id;
    raise exception 'Box % belongs to shipment %, not this one. Put it aside.', p_box_id, v_ref;
  end if;
  if v_box.status = 'void' then
    raise exception 'Box % is void (%). It must not ship.', p_box_id, v_box.void_reason;
  end if;
  if v_box.status = 'back_to_farm' then
    raise exception 'Box % was sent BACK TO FARM (%). It must not ship.', p_box_id,
      (select string_agg(q.label, ', ' order by q.sort_order) from qc_reasons q where q.code = any (v_box.qc_reasons));
  end if;
  v_repeat := exists (select 1 from qc_events where id = p_event_id and box_id = p_box_id);
  select * into v_before from qc_events
  where box_id = p_box_id and kind = 'scan' and id <> p_event_id order by happened_at limit 1;
  if not v_repeat then
    insert into qc_events (id, box_id, kind, happened_at) values (p_event_id, p_box_id, 'scan', coalesce(p_scanned_at, now()));
    if v_box.received_at is null and v_box.status = 'active' then
      update boxes set received_at = coalesce(p_scanned_at, now()), received_by = auth.uid() where id = p_box_id;
    end if;
  end if;
  return public.qc_box_summary(p_box_id) || jsonb_build_object(
    'scanned_before', v_before.id is not null,
    'first_scanned_at', v_before.happened_at
  );
end;
$$;

-- Records a QC result for one or more boxes. p_event_id makes a resend harmless.
create or replace function public.qc_record(
  p_event_id uuid,
  p_box_ids bigint[],
  p_result text,
  p_reasons text[] default '{}',
  p_note text default null,
  p_happened_at timestamptz default now()
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_bad text;
  v_count int;
  v_pair record;
begin
  perform public.require_qc();
  if p_result not in ('pass', 'minor', 'major', 'critical') then
    raise exception 'Choose Pass, Minor, Major or Critical.';
  end if;
  if coalesce(array_length(p_box_ids, 1), 0) = 0 then
    raise exception 'Choose the boxes.';
  end if;
  if exists (select 1 from qc_events where id = p_event_id) then
    return 0; -- already recorded (sent twice)
  end if;

  if p_result = 'pass' then
    v_reasons := '{}';
  else
    if cardinality(v_reasons) = 0 then
      raise exception 'Choose at least one reason.';
    end if;
    select string_agg(r, ', ') into v_bad from unnest(v_reasons) r where not exists (select 1 from qc_reasons q where q.code = r and q.active);
    if v_bad is not null then raise exception 'Unknown QC reason: %.', v_bad; end if;
    select string_agg(q.label, ', ') into v_bad from qc_reasons q where q.code = any (v_reasons) and q.needs_note;
    if v_bad is not null and length(coalesce(v_note, '')) < 3 then
      raise exception 'Add a note for: %.', v_bad;
    end if;
    select string_agg(q.label, ', ') into v_bad from qc_reasons q where q.code = any (v_reasons) and q.critical_only;
    if v_bad is not null and p_result <> 'critical' then
      raise exception '% always means BACK TO FARM. Choose Critical.', v_bad;
    end if;
  end if;

  select format('Box %s %s.', x.id, x.why) into v_bad
  from (
    select ids.id,
      case
        when b.id is null then 'doesn''t exist'
        when b.status = 'void' then 'is void'
        when b.status = 'back_to_farm' then 'was already sent back to the farm'
        when b.received_at is null then 'hasn''t been received yet, so it can''t be checked'
        when p_result in ('pass', 'minor') and b.qc_status = 'failed'
             and not public.has_any_role(array['admin', 'senior_qc']::public.app_role[])
          then 'failed QC (Major). Only a Senior QC or an Admin can clear it'
      end as why
    from unnest(p_box_ids) as ids (id)
    left join boxes b on b.id = ids.id
  ) x
  where x.why is not null
  order by x.id limit 1;
  if v_bad is not null then raise exception '%', v_bad; end if;

  update boxes set
    qc_status = case when p_result in ('pass', 'minor') then 'passed' else 'failed' end,
    qc_severity = case when p_result = 'pass' then null else p_result end,
    qc_reasons = v_reasons,
    qc_note = v_note,
    qc_at = coalesce(p_happened_at, now()),
    qc_by = auth.uid(),
    status = case when p_result = 'critical' then 'back_to_farm' else status end,
    void_reason = case when p_result = 'critical'
      then 'Back to farm: ' || (select string_agg(q.label, ', ' order by q.sort_order) from qc_reasons q where q.code = any (v_reasons))
      else void_reason end,
    voided_at = case when p_result = 'critical' then now() else voided_at end,
    voided_by = case when p_result = 'critical' then auth.uid() else voided_by end
  where id = any (p_box_ids);
  get diagnostics v_count = row_count;

  insert into qc_events (id, box_id, kind, result, reasons, note, happened_at)
  select p_event_id, id, 'result', p_result, v_reasons, v_note, coalesce(p_happened_at, now())
  from unnest(p_box_ids) as id;

  if p_result = 'critical' then
    for v_pair in select distinct shipment_id, customer_id from boxes where id = any (p_box_ids) loop
      perform public.renumber_boxes(v_pair.shipment_id, v_pair.customer_id);
    end loop;
  end if;
  return v_count;
end;
$$;

-- Item 3's simple pass/fail, kept for callers that use it: a failure becomes Major, reason "Other".
create or replace function public.set_qc_result(p_box_ids bigint[], p_passed boolean, p_note text default null)
returns int
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_qc();
  if not p_passed and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why the boxes failed QC.';
  end if;
  return public.qc_record(gen_random_uuid(), p_box_ids,
    case when p_passed then 'pass' else 'major' end,
    case when p_passed then '{}'::text[] else array['other'] end, p_note);
end;
$$;

-- What a BACK TO FARM sticker shows, sized like the buyer's box label so it fits the same roll.
-- Logs each print.
create or replace function public.back_to_farm_sticker(p_box_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_box boxes%rowtype;
  v_size record;
  v_by text;
begin
  perform public.require_qc();
  select * into v_box from boxes where id = p_box_id;
  if not found or v_box.status <> 'back_to_farm' then
    raise exception 'Box % hasn''t been sent back to the farm.', p_box_id;
  end if;
  select v.width_mm, v.height_mm, v.orientation into v_size
  from label_template_versions v where v.id = public.label_template_version_for(v_box.customer_id);
  select coalesce(nullif(btrim(p.full_name), ''), u.email) into v_by
  from auth.users u left join profiles p on p.id = u.id where u.id = v_box.qc_by;
  insert into back_to_farm_stickers (box_id) values (p_box_id);
  return jsonb_build_object(
    'data', public.box_label_data(p_box_id),
    'reasons', (select coalesce(jsonb_agg(q.label order by q.sort_order), '[]') from qc_reasons q where q.code = any (v_box.qc_reasons)),
    'note', v_box.qc_note,
    'qc_by', v_by,
    'qc_at', v_box.qc_at,
    'width_mm', coalesce(v_size.width_mm, 150),
    'height_mm', coalesce(v_size.height_mm, 70),
    'orientation', coalesce(v_size.orientation, 'rotated'),
    'printed_before', (select count(*) > 1 from back_to_farm_stickers where box_id = p_box_id)
  );
end;
$$;

-- box_overview lists boxes.* as they were when it was made; recreate it to add the new columns.
drop view public.box_overview;
create view public.box_overview with (security_invoker = true) as
select b.*,
       lp.printed_at as last_printed_at,
       lp.kind as last_print_kind,
       (lp.id is not null and (lp.buyer_box_no, lp.buyer_box_total, lp.farm_box_no, lp.farm_box_total)
          is distinct from (b.buyer_box_no, b.buyer_box_total, b.farm_box_no, b.farm_box_total)
          and b.status = 'active') as label_out_of_date,
       exists (select 1 from public.qc_events e where e.box_id = b.id and e.kind = 'scan') as scanned,
       (select count(*) from public.qc_photos ph where ph.box_id = b.id)::int as photo_count
from public.boxes b
left join lateral (
  select l.* from public.label_prints l where l.box_id = b.id order by l.printed_at desc, l.id desc limit 1
) lp on true;
grant select on public.box_overview to authenticated;

-- QC users (and Senior QC) read what they check.
drop policy "boxes: read" on public.boxes;
create policy "boxes: read" on public.boxes for select to authenticated
  using (
    public.has_any_role(array['admin', 'consolidator', 'finance', 'qc', 'senior_qc']::public.app_role[])
    or farm_id = public.my_farm_id()
    or customer_id = public.my_customer_id()
  );

revoke execute on function public.require_qc(), public.qc_box_summary(bigint) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'is_qc()',
    'qc_scan(uuid, uuid, bigint, timestamptz)',
    'qc_record(uuid, bigint[], text, text[], text, timestamptz)',
    'set_qc_result(bigint[], boolean, text)',
    'back_to_farm_sticker(bigint)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
