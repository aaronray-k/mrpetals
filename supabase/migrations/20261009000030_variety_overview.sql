-- Varieties at a glance: each webshop variety with its photo, stem lengths and the farms that grow it (names
-- only, never prices). For the Varieties page and, later, the webshop's "grown by".
create or replace function public.variety_overview()
returns table (
  id uuid, flower_type text, name text, grade text, colour text, photo text, active boolean,
  lengths int[], growers text[], grower_groups text[]
)
language sql stable security definer set search_path = public
as $$
  select v.id, v.flower_type, v.name, v.grade, v.colour, v.photo, v.active,
         coalesce((select array_agg(distinct p.stem_length_cm order by p.stem_length_cm) from products p where p.variety_id = v.id and p.active), '{}'),
         coalesce((select array_agg(distinct f.farm_name order by f.farm_name)
                   from products p join price_list pl on pl.product_id = p.id join farms f on f.id = pl.farm_id
                   where p.variety_id = v.id and f.active and (pl.valid_to is null or pl.valid_to >= current_date)), '{}'),
         coalesce((select array_agg(distinct coalesce(f.grower, f.farm_name) order by coalesce(f.grower, f.farm_name))
                   from products p join price_list pl on pl.product_id = p.id join farms f on f.id = pl.farm_id
                   where p.variety_id = v.id and f.active and (pl.valid_to is null or pl.valid_to >= current_date)), '{}')
  from varieties v
  where auth.uid() is not null
  order by v.flower_type, v.name
$$;
revoke all on function public.variety_overview() from public, anon;
grant execute on function public.variety_overview() to authenticated;
