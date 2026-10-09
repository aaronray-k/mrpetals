-- Airlines for the load planner: which containers each flies on ConsolFlora's routes, and their rates per kg
-- (freight_rates, by destination, entered from the freight agent's quotes). Plus a shipment's boxes by size.
create table public.airlines (
  code text primary key check (code ~ '^[A-Z0-9]{2}$'),
  name text not null,
  -- Load planner container codes: AKE, PMC-LD (lower deck 163 cm), PMC-MD244, PMC-MD300 (main deck, freighters).
  ulds text[] not null default '{AKE,PMC-LD}',
  -- Where it connects on the way to Japan and the Far East.
  via text,
  notes text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid()
);
insert into public.airlines (code, name, ulds, via, notes) values
  ('EK', 'Emirates SkyCargo', '{AKE,PMC-LD,PMC-MD300}', 'DXB', 'Passenger 777s carry AKE and PMC on the lower deck; 777 freighters take main-deck PMC.'),
  ('QR', 'Qatar Airways Cargo', '{AKE,PMC-LD,PMC-MD300}', 'DOH', 'Passenger 777/787 lower deck; 777 freighters main deck.'),
  ('ET', 'Ethiopian Cargo', '{AKE,PMC-LD,PMC-MD300}', 'ADD', 'Passenger 787/350 lower deck; 777 freighters main deck.'),
  ('TK', 'Turkish Cargo', '{AKE,PMC-LD,PMC-MD300}', 'IST', 'Passenger 777/330 lower deck; freighters main deck.'),
  ('KQ', 'Kenya Airways Cargo', '{AKE,PMC-LD}', 'NBO', 'Passenger 787 lower deck; Japan via partner airlines.');
create trigger airlines_touch before update on public.airlines for each row execute function public.touch_updated();
alter table public.airlines enable row level security;
create policy "airlines: staff, finance and qc read" on public.airlines for select to authenticated
  using (public.has_any_role(array['admin', 'consolidator', 'finance', 'qc', 'senior_qc']::public.app_role[]));
create policy "airlines: staff insert" on public.airlines for insert to authenticated with check (public.is_staff());
create policy "airlines: staff update" on public.airlines for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- A shipment's boxes (not voided or sent back) by box type: size, how many, and the estimated weight of a full
-- box (the pack rate's estimate for its product, else the box's own weight).
create or replace function public.shipment_load_lines(p_shipment_id uuid)
returns table (box_type_id uuid, box_code text, description text, length_cm numeric, width_cm numeric, height_cm numeric, boxes int, est_weight_kg numeric)
language sql stable security definer set search_path = public
as $$
  select bt.id, bt.box_code, bt.description, bt.length_cm, bt.width_cm, bt.height_cm, count(*)::int,
         round(avg(coalesce(pr.est_gross_weight_kg, bt.tare_weight_kg)), 2)
  from boxes b
  join box_types bt on bt.id = b.box_type_id
  left join pack_rates pr on pr.product_id = b.product_id and pr.box_type_id = b.box_type_id
  where b.shipment_id = p_shipment_id and b.status = 'active'
    and public.has_any_role(array['admin', 'consolidator', 'finance', 'qc', 'senior_qc']::public.app_role[])
  group by bt.id, bt.box_code, bt.description, bt.length_cm, bt.width_cm, bt.height_cm
  order by count(*) desc
$$;
revoke all on function public.shipment_load_lines(uuid) from public, anon;
grant execute on function public.shipment_load_lines(uuid) to authenticated;
