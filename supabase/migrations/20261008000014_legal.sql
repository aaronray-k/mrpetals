-- Item 8: Legal and consent.
-- Everyone agrees to the documents for their role before using the app: buyers the Terms of sale,
-- farms the Supplier terms, ConsolFlora staff the Terms of use, and everyone the Privacy and Cookie
-- notices. Each acceptance is stored with the document version and time. Until someone has accepted
-- the current versions, the role checks treat them as having no access, so nothing can be read or
-- changed through the API either. Marketing email is a separate, optional choice.
-- Only business contact details are kept: no ID numbers or dates of birth.

create table public.legal_documents (
  code text primary key check (code ~ '^[a-z][a-z-]{2,40}$'),
  title text not null,
  version text not null, -- matches the version in src/lib/legal/documents.ts
  -- Who must accept it: roles, or 'all'.
  audience text[] not null,
  published_on date not null default current_date
);

insert into public.legal_documents (code, title, version, audience) values
  ('terms-of-sale', 'Terms of sale', '2026-10-07', array['customer']),
  ('supplier-terms', 'Supplier terms', '2026-10-07', array['farm']),
  ('terms-of-use', 'Terms of use for ConsolFlora staff', '2026-10-07', array['admin', 'consolidator', 'finance', 'qc', 'senior_qc']),
  ('privacy', 'Privacy notice', '2026-10-07', array['all']),
  ('cookies', 'Cookie notice', '2026-10-07', array['all']);

create table public.legal_acceptances (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_code text not null references public.legal_documents (code),
  version text not null,
  accepted_at timestamptz not null default now(),
  user_agent text,
  unique (user_id, document_code, version)
);

-- legal_ok: has accepted the current version of every document for their roles. Kept up to date below,
-- and read by the role checks (cheap: the same profiles row they already read).
alter table public.profiles
  add column legal_ok boolean not null default false,
  add column marketing_opt_in boolean not null default false,
  add column marketing_updated_at timestamptz;

alter table public.legal_documents enable row level security;
create policy "legal_documents: anyone reads" on public.legal_documents for select to anon, authenticated using (true);
grant select on public.legal_documents to anon;
alter table public.legal_acceptances enable row level security;
create policy "legal_acceptances: own or admin" on public.legal_acceptances for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));

-- The documents a user still has to accept (current version, for any of their roles).
create or replace function public.pending_documents(p_user_id uuid)
returns setof public.legal_documents
language sql stable security definer set search_path = public
as $$
  select d.* from legal_documents d
  where ('all' = any (d.audience) or exists (select 1 from user_roles r where r.user_id = p_user_id and r.role::text = any (d.audience)))
    and not exists (select 1 from legal_acceptances a where a.user_id = p_user_id and a.document_code = d.code and a.version = d.version)
  order by case when 'all' = any (d.audience) then 1 else 0 end, d.code
$$;
revoke execute on function public.pending_documents(uuid) from public, anon, authenticated;

create or replace function public.refresh_legal_ok(p_user_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update profiles set legal_ok = not exists (select 1 from public.pending_documents(p_user_id)) where id = p_user_id
$$;
revoke execute on function public.refresh_legal_ok(uuid) from public, anon, authenticated;

-- For the signed-in user: what they must accept now.
create or replace function public.my_pending_documents()
returns setof public.legal_documents
language sql stable security definer set search_path = public
as $$ select * from public.pending_documents(auth.uid()) $$;

create or replace function public.accept_documents(p_documents jsonb, p_marketing boolean default null, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  d record;
  v_given jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  for d in select * from public.pending_documents(auth.uid()) loop
    select e into v_given from jsonb_array_elements(coalesce(p_documents, '[]')) e where e ->> 'code' = d.code;
    if v_given is null then
      raise exception 'Please read and accept the %.', d.title;
    end if;
    if v_given ->> 'version' is distinct from d.version then
      raise exception 'The % has been updated. Reload the page to read the current version.', d.title;
    end if;
    insert into legal_acceptances (user_id, document_code, version, user_agent)
    values (auth.uid(), d.code, d.version, left(p_user_agent, 300))
    on conflict do nothing;
  end loop;
  if p_marketing is not null then
    update profiles set marketing_opt_in = p_marketing, marketing_updated_at = now() where id = auth.uid();
  end if;
  perform public.refresh_legal_ok(auth.uid());
end;
$$;

-- Marketing email: optional, changed at any time from My account.
create or replace function public.set_marketing_opt_in(p_opt_in boolean)
returns void
language sql security definer set search_path = public
as $$
  update profiles set marketing_opt_in = p_opt_in, marketing_updated_at = now() where id = auth.uid()
$$;

-- What a user agreed to and when (for My account).
create or replace function public.my_agreements()
returns table (code text, title text, version text, current_version text, accepted_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select distinct on (a.document_code) a.document_code, d.title, a.version, d.version, a.accepted_at
  from legal_acceptances a join legal_documents d on d.code = a.document_code
  where a.user_id = auth.uid()
  order by a.document_code, a.accepted_at desc
$$;

-- A new version of a document: everyone it applies to is asked again.
create or replace function public.legal_documents_changed()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.version is distinct from old.version then
    update profiles p set legal_ok = false
    where p.legal_ok and ('all' = any (new.audience) or exists (select 1 from user_roles r where r.user_id = p.id and r.role::text = any (new.audience)));
  end if;
  return new;
end;
$$;
create trigger legal_documents_changed after update on public.legal_documents for each row execute function public.legal_documents_changed();

-- A new role can bring new documents to accept.
create or replace function public.user_roles_legal()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.refresh_legal_ok(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;
create trigger user_roles_legal after insert or delete on public.user_roles for each row execute function public.user_roles_legal();

-- ---------------------------------------------------------------------------
-- The role checks: active accounts that have accepted the current documents.
-- ---------------------------------------------------------------------------
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = _role and p.active and p.legal_ok
  )
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = any (_roles) and p.active and p.legal_ok
  )
$$;

create or replace function public.my_farm_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select farm_id from public.profiles where id = auth.uid() and active and legal_ok $$;

create or replace function public.my_customer_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select customer_id from public.profiles where id = auth.uid() and active and legal_ok $$;

-- Users page: agreements and marketing choice per user.
create or replace function public.admin_list_agreements()
returns table (user_id uuid, legal_ok boolean, pending text[], accepted jsonb, marketing_opt_in boolean, marketing_updated_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only Admin users can see agreements.' using errcode = '42501';
  end if;
  return query
  select p.id, p.legal_ok,
         coalesce((select array_agg(d.title order by d.code) from public.pending_documents(p.id) d), '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('title', d.title, 'version', a.version, 'accepted_at', a.accepted_at) order by a.accepted_at)
                   from legal_acceptances a join legal_documents d on d.code = a.document_code where a.user_id = p.id), '[]'),
         p.marketing_opt_in, p.marketing_updated_at
  from profiles p;
end;
$$;

-- Everyone already here is asked at their next sign-in (legal_ok starts false).
