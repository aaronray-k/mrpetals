-- Box label templates (item 2).
-- A template is saved as numbered versions that never change; every print records the
-- version it used. The QR code, box id and "Box n of N" can't be removed from a layout.

create or replace function public.label_layout_is_valid(layout jsonb)
returns boolean
language sql immutable
as $$
  select case when jsonb_typeof(layout -> 'elements') = 'array' then (
    select count(*) filter (where e ->> 'type' = 'qr') = 1
       and count(*) filter (where e ->> 'type' = 'box_id') = 1
       and count(*) filter (where e ->> 'type' = 'box_count') = 1
    from jsonb_array_elements(layout -> 'elements') as e
  ) else false end
$$;

create table public.label_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  -- The buyer this template is for. The default template prints for buyers without their own.
  customer_id uuid references public.customers (id),
  is_default boolean not null default false,
  active boolean not null default true,
  current_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  check (not (is_default and customer_id is not null))
);
create unique index label_templates_one_default on public.label_templates ((true)) where is_default and active;
create unique index label_templates_one_per_buyer on public.label_templates (customer_id) where customer_id is not null and active;
create trigger label_templates_touch before update on public.label_templates for each row execute function public.touch_updated();

create table public.label_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.label_templates (id),
  version int not null check (version >= 1),
  width_mm numeric(5, 1) not null check (width_mm between 20 and 300),
  height_mm numeric(5, 1) not null check (height_mm between 20 and 300),
  -- 'rotated': fed sideways, e.g. a 150 mm wide label on a 4-inch printer.
  orientation text not null check (orientation in ('normal', 'rotated')),
  layout jsonb not null check (public.label_layout_is_valid(layout)),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  unique (template_id, version)
);

-- Every label printed for a box, so reprints can be traced (who, when, why, which layout).
create table public.label_prints (
  id uuid primary key default gen_random_uuid(),
  box_id bigint not null, -- references public.boxes from item 3
  template_version_id uuid not null references public.label_template_versions (id),
  kind text not null check (kind in ('print', 'reprint')),
  reason text,
  printed_by uuid not null default auth.uid() references auth.users (id),
  printed_at timestamptz not null default now(),
  check (kind <> 'reprint' or length(btrim(coalesce(reason, ''))) >= 3)
);
create index label_prints_box_idx on public.label_prints (box_id);

alter table public.label_templates enable row level security;
alter table public.label_template_versions enable row level security;
alter table public.label_prints enable row level security;

-- People who print labels can read templates; only Admin designs them.
create policy "label_templates: printers read" on public.label_templates for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'qc']::public.app_role[]));
create policy "label_templates: admin insert" on public.label_templates for insert to authenticated
  with check (public.has_role('admin'));
create policy "label_templates: admin update" on public.label_templates for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "label_template_versions: printers read" on public.label_template_versions for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'qc']::public.app_role[]));
create policy "label_template_versions: admin insert" on public.label_template_versions for insert to authenticated
  with check (public.has_role('admin') and created_by = auth.uid());
-- No update or delete policies: a saved version never changes.

create policy "label_prints: printers read" on public.label_prints for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'qc']::public.app_role[]));
create policy "label_prints: printers log own" on public.label_prints for insert to authenticated
  with check (public.has_any_role(array['admin', 'consolidator', 'qc']::public.app_role[]) and printed_by = auth.uid());

-- Each template with its latest version. security_invoker: the caller's RLS applies.
create view public.label_templates_current with (security_invoker = true) as
select t.*, v.id as version_id, v.width_mm, v.height_mm, v.orientation, v.layout,
       v.created_at as version_created_at, v.created_by as version_created_by
from public.label_templates t
left join public.label_template_versions v on v.template_id = t.id and v.version = t.current_version;

-- Saves a template as a new version (creating the template on first save).
-- p_expected_version guards against two Admins overwriting each other's work.
create or replace function public.save_label_template(
  p_template_id uuid,
  p_name text,
  p_customer_id uuid,
  p_is_default boolean,
  p_width_mm numeric,
  p_height_mm numeric,
  p_orientation text,
  p_layout jsonb,
  p_expected_version int default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := p_template_id;
  v_current int := 0;
begin
  if not public.has_role('admin') then
    raise exception 'Only Admin users can change label templates.' using errcode = '42501';
  end if;

  begin
    if v_id is null then
      insert into label_templates (name, customer_id, is_default)
      values (btrim(p_name), p_customer_id, coalesce(p_is_default, false))
      returning id into v_id;
    else
      select current_version into v_current from label_templates where id = v_id for update;
      if not found then
        raise exception 'This label template no longer exists.';
      end if;
      if p_expected_version is not null and v_current <> p_expected_version then
        raise exception 'Someone saved version % of this template while you were editing. Reload it to see their changes.', v_current;
      end if;
      update label_templates
      set name = btrim(p_name), customer_id = p_customer_id, is_default = coalesce(p_is_default, false)
      where id = v_id;
    end if;
  exception when unique_violation then
    if p_customer_id is not null then
      raise exception 'This buyer already has a label template. Each buyer can have one: change that one instead.';
    end if;
    raise exception 'There is already a default label template. Only one template can be the default.';
  end;

  insert into label_template_versions (template_id, version, width_mm, height_mm, orientation, layout)
  values (v_id, v_current + 1, p_width_mm, p_height_mm, p_orientation, p_layout);
  update label_templates set current_version = v_current + 1 where id = v_id;

  return jsonb_build_object('template_id', v_id, 'version', v_current + 1);
end;
$$;

-- The template version to print for a buyer: their own template, otherwise the default one.
create or replace function public.label_template_version_for(p_customer_id uuid)
returns uuid
language sql stable
security invoker
set search_path = public
as $$
  select v.id
  from label_templates t
  join label_template_versions v on v.template_id = t.id and v.version = t.current_version
  where t.active and (t.customer_id = p_customer_id or t.is_default)
  order by t.customer_id is not distinct from p_customer_id desc
  limit 1
$$;

revoke execute on function public.save_label_template(uuid, text, uuid, boolean, numeric, numeric, text, jsonb, int) from public, anon;
grant execute on function public.save_label_template(uuid, text, uuid, boolean, numeric, numeric, text, jsonb, int) to authenticated;
revoke execute on function public.label_template_version_for(uuid) from public, anon;
grant execute on function public.label_template_version_for(uuid) to authenticated;
