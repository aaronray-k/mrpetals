-- User management (Admin creates accounts and gives roles). Accounts themselves are created by the
-- app's server through Supabase Auth's admin API (it holds the service-role key, and only after
-- checking the caller is an Admin); these functions set roles, names, links and the active flag.

alter table public.profiles add column active boolean not null default true;

-- Everyone with an account: email, name, roles, links. Admin only.
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, full_name text, roles text[], farm_id uuid, customer_id uuid, active boolean,
  created_at timestamptz, last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only Admin users can see the user list.' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, p.full_name,
         coalesce((select array_agg(r.role::text order by r.role::text) from user_roles r where r.user_id = u.id), '{}'),
         p.farm_id, p.customer_id, coalesce(p.active, true), u.created_at, u.last_sign_in_at
  from auth.users u left join profiles p on p.id = u.id
  order by lower(u.email::text);
end;
$$;

-- Sets a user's name, roles (replacing the old ones), farm or buyer link, and whether they may sign in.
create or replace function public.admin_set_user(
  p_user_id uuid, p_full_name text, p_roles text[], p_farm_id uuid default null, p_customer_id uuid default null, p_active boolean default true
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_bad text;
begin
  if not public.has_role('admin') then
    raise exception 'Only Admin users can change users.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception 'This user doesn''t exist.'; end if;
  select string_agg(r, ', ') into v_bad from unnest(coalesce(p_roles, '{}')) r
  where r not in (select unnest(enum_range(null::app_role))::text);
  if v_bad is not null then raise exception 'Unknown role: %.', v_bad; end if;
  if p_user_id = auth.uid() and (not ('admin' = any (coalesce(p_roles, '{}'))) or not p_active) then
    raise exception 'You can''t remove your own Admin role or switch off your own account.';
  end if;
  if 'farm' = any (p_roles) and p_farm_id is null then raise exception 'A Farm user needs their farm.'; end if;
  if 'customer' = any (p_roles) and p_customer_id is null then raise exception 'A Customer user needs their buyer company.'; end if;
  if 'senior_qc' = any (p_roles) and not ('qc' = any (p_roles)) then p_roles := p_roles || array['qc']; end if;

  delete from user_roles where user_id = p_user_id;
  insert into user_roles (user_id, role) select p_user_id, r::app_role from unnest(coalesce(p_roles, '{}')) r;
  insert into profiles (id) values (p_user_id) on conflict (id) do nothing;
  update profiles
  set full_name = nullif(btrim(coalesce(p_full_name, '')), ''),
      farm_id = case when 'farm' = any (p_roles) then p_farm_id end,
      customer_id = case when 'customer' = any (p_roles) then p_customer_id end,
      active = p_active
  where id = p_user_id;
end;
$$;

-- Switched-off accounts lose their roles' access at once: the helpers check the flag.
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r left join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = _role and coalesce(p.active, true)
  )
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r left join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = any (_roles) and coalesce(p.active, true)
  )
$$;

revoke execute on function public.admin_list_users(), public.admin_set_user(uuid, text, text[], uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_list_users(), public.admin_set_user(uuid, text, text[], uuid, uuid, boolean) to authenticated;
