-- Real boxes for the load planner: board thickness and bulging per box type, and load checks (how many boxes
-- the planner said would fit against how many really went in), from which the planner's accuracy and a better
-- bulge figure are worked out.
alter table public.box_types
  -- Whether length/width/height are measured outside (as the airline measures) or inside the box.
  add column size_basis text not null default 'outside' check (size_basis in ('outside', 'inside')),
  add column wall_mm numeric(5, 1) not null default 5 check (wall_mm between 0 and 30),
  -- How far a full box swells in the middle of each face, mm per face.
  add column bulge_top_mm numeric(5, 1) not null default 10 check (bulge_top_mm between 0 and 100),
  add column bulge_side_mm numeric(5, 1) not null default 5 check (bulge_side_mm between 0 and 100),
  add column bulge_end_mm numeric(5, 1) not null default 0 check (bulge_end_mm between 0 and 100);

create table public.load_checks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) default auth.uid(),
  shipment_id uuid references public.shipments (id),
  airline text,
  uld_code text not null,
  planned_boxes int not null check (planned_boxes >= 0),
  actual_boxes int not null check (actual_boxes >= 0),
  -- What was planned: box lines (sizes, allowances, counts) and options, so the plan can be re-run with other
  -- bulge figures.
  plan jsonb not null,
  note text check (char_length(note) <= 500)
);
create index load_checks_created_idx on public.load_checks (created_at desc);
alter table public.load_checks enable row level security;
create policy "load_checks: staff, finance and qc read" on public.load_checks for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance', 'qc', 'senior_qc']::public.app_role[]));
-- The people who load containers record what really went in.
create policy "load_checks: staff and qc insert" on public.load_checks for insert to authenticated
  with check (public.has_any_role(array['admin', 'consolidator', 'qc', 'senior_qc']::public.app_role[]) and created_by = auth.uid());

-- A shipment's boxes by box type, now with each type's size basis, board thickness and bulge.
drop function public.shipment_load_lines(uuid);
create function public.shipment_load_lines(p_shipment_id uuid)
returns table (box_type_id uuid, box_code text, description text, length_cm numeric, width_cm numeric, height_cm numeric, boxes int, est_weight_kg numeric,
               size_basis text, wall_mm numeric, bulge_top_mm numeric, bulge_side_mm numeric, bulge_end_mm numeric)
language sql stable security definer set search_path = public
as $$
  select bt.id, bt.box_code, bt.description, bt.length_cm, bt.width_cm, bt.height_cm, count(*)::int,
         round(avg(coalesce(pr.est_gross_weight_kg, bt.tare_weight_kg)), 2),
         bt.size_basis, bt.wall_mm, bt.bulge_top_mm, bt.bulge_side_mm, bt.bulge_end_mm
  from boxes b
  join box_types bt on bt.id = b.box_type_id
  left join pack_rates pr on pr.product_id = b.product_id and pr.box_type_id = b.box_type_id
  where b.shipment_id = p_shipment_id and b.status = 'active'
    and public.has_any_role(array['admin', 'consolidator', 'finance', 'qc', 'senior_qc']::public.app_role[])
  group by bt.id
  order by count(*) desc
$$;
revoke all on function public.shipment_load_lines(uuid) from public, anon;
grant execute on function public.shipment_load_lines(uuid) to authenticated;
