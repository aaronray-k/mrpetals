-- Preview site only: the parts of Supabase the app needs, on a plain Postgres (Render).
-- Sign-in passwords, refresh tokens and stored files live here, behind preview/gateway.mjs.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
-- The owner switches into these roles (seed) and PostgREST's login role does too.
grant anon, authenticated to current_user;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  encrypted_password text,
  must_change_password boolean not null default false,
  banned boolean not null default false,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
create table if not exists auth.refresh_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);
-- Each sign-in is one session; refreshing keeps it (Supabase puts session_id in the access token).
alter table auth.refresh_tokens add column if not exists session_id uuid not null default gen_random_uuid();
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
grant usage on schema auth, public, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid default auth.uid(),
  content_type text,
  data bytea,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
-- Upsert of an existing photo path: same people who may upload.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'preview: overwrite own upload') then
    create policy "preview: overwrite own upload" on storage.objects for update to authenticated using (owner = auth.uid());
  end if;
end $$;

create schema if not exists preview;
create table if not exists preview.applied (name text primary key, applied_at timestamptz not null default now());
