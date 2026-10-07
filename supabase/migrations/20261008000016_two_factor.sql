-- Item 9: two-factor sign-in for Admin, Consolidator and Finance.
-- After the password, the person gives a 6-digit code from an authenticator app (TOTP, RFC 6238) or
-- sent to their email. The check is tied to the sign-in session (the JWT's session_id), so until it is
-- done those roles get no access, even through the API. A device can be remembered for 30 days.
-- Secrets, codes and device tokens are only reachable through the functions below.

create table public.security_settings (
  id boolean primary key default true check (id),
  two_factor_roles public.app_role[] not null default array['admin', 'consolidator', 'finance']::public.app_role[],
  remember_device_days int not null default 30 check (remember_device_days between 0 and 90),
  -- PREVIEW ONLY: email isn't connected, so the code is shown on screen. Never true in production.
  demo_show_email_codes boolean not null default false
);
insert into public.security_settings default values;
alter table public.security_settings enable row level security;
create policy "security_settings: signed-in read" on public.security_settings for select to authenticated using (true);

create table public.two_factor_totp (
  user_id uuid primary key references auth.users (id) on delete cascade,
  secret bytea not null,
  confirmed_at timestamptz,
  last_step bigint, -- a code can't be used twice
  created_at timestamptz not null default now()
);
create table public.two_factor_email_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0
);
create table public.two_factor_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  method text not null check (method in ('totp', 'email', 'device')),
  verified_at timestamptz not null default now()
);
create table public.two_factor_devices (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz
);
create table public.two_factor_failures (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index two_factor_failures_idx on public.two_factor_failures (user_id, at);
-- No policies: nobody reads these tables directly.
alter table public.two_factor_totp enable row level security;
alter table public.two_factor_email_codes enable row level security;
alter table public.two_factor_sessions enable row level security;
alter table public.two_factor_devices enable row level security;
alter table public.two_factor_failures enable row level security;

-- The sign-in session from the JWT (Supabase puts session_id in every access token).
create or replace function public.current_session_id()
returns uuid
language sql stable
as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.session_id', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id'), '')::uuid
$$;

-- Does this user need the second step, and has this session done it?
create or replace function public.two_factor_ok(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
           select 1 from user_roles r, security_settings s
           where r.user_id = p_user_id and r.role = any (s.two_factor_roles))
      or exists (select 1 from two_factor_sessions t where t.user_id = p_user_id and t.session_id = public.current_session_id())
$$;

-- ---------------------------------------------------------------------------
-- TOTP (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits)
-- ---------------------------------------------------------------------------
create or replace function public.base32(p bytea)
returns text
language plpgsql immutable
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  bits text := '';
  out text := '';
  i int;
begin
  for i in 0 .. length(p) - 1 loop
    bits := bits || lpad(get_byte(p, i)::bit(8)::text, 8, '0');
  end loop;
  while length(bits) % 5 <> 0 loop bits := bits || '0'; end loop;
  for i in 0 .. length(bits) / 5 - 1 loop
    out := out || substr(alphabet, ('b' || substr(bits, i * 5 + 1, 5))::bit(5)::int + 1, 1);
  end loop;
  return out;
end;
$$;

create or replace function public.totp_code(p_secret bytea, p_step bigint)
returns text
language plpgsql immutable set search_path = public, extensions
as $$
declare
  msg bytea := decode(lpad(to_hex(p_step), 16, '0'), 'hex');
  h bytea := hmac(msg, p_secret, 'sha1');
  o int := get_byte(h, 19) & 15;
  bin bigint := ((get_byte(h, o) & 127)::bigint << 24) | (get_byte(h, o + 1)::bigint << 16) | (get_byte(h, o + 2)::bigint << 8) | get_byte(h, o + 3);
begin
  return lpad((bin % 1000000)::text, 6, '0');
end;
$$;
revoke execute on function public.totp_code(bytea, bigint) from public, anon, authenticated;

create or replace function public.too_many_two_factor_failures(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select count(*) >= 5 from two_factor_failures where user_id = p_user_id and at > now() - interval '15 minutes' $$;

-- Marks this session as verified, and optionally remembers the device. Returns the device token.
create or replace function public.two_factor_pass(p_method text, p_remember boolean)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_token text;
  v_days int := (select remember_device_days from security_settings);
begin
  if public.current_session_id() is null then raise exception 'Sign in again to finish two-factor sign-in.'; end if;
  insert into two_factor_sessions (session_id, user_id, method) values (public.current_session_id(), auth.uid(), p_method)
  on conflict (session_id) do update set verified_at = now(), method = excluded.method;
  delete from two_factor_failures where user_id = auth.uid();
  if p_remember and v_days > 0 then
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into two_factor_devices (user_id, token_hash, expires_at)
    values (auth.uid(), encode(digest(v_token, 'sha256'), 'hex'), now() + make_interval(days => v_days));
  end if;
  return v_token;
end;
$$;
revoke execute on function public.two_factor_pass(text, boolean) from public, anon, authenticated;

-- What the sign-in screen needs to know.
create or replace function public.my_two_factor_status()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'required', exists (select 1 from user_roles r, security_settings s where r.user_id = auth.uid() and r.role = any (s.two_factor_roles)),
    'verified', public.two_factor_ok(auth.uid()),
    'totp', exists (select 1 from two_factor_totp where user_id = auth.uid() and confirmed_at is not null),
    'email_available', (select enabled from mail_settings) or (select demo_show_email_codes from security_settings),
    'remember_days', (select remember_device_days from security_settings),
    'devices', (select count(*) from two_factor_devices where user_id = auth.uid() and expires_at > now()),
    'locked', public.too_many_two_factor_failures(auth.uid()))
$$;

-- Authenticator app: start setup (a new secret, until confirmed).
create or replace function public.start_totp_setup()
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_secret bytea := gen_random_bytes(20);
  v_email text := (select email from auth.users where id = auth.uid());
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if exists (select 1 from two_factor_totp where user_id = auth.uid() and confirmed_at is not null) and not public.two_factor_ok(auth.uid()) then
    raise exception 'An authenticator app is already set up. Use its code, or ask an Admin to reset it.';
  end if;
  insert into two_factor_totp (user_id, secret) values (auth.uid(), v_secret)
  on conflict (user_id) do update set secret = excluded.secret, confirmed_at = null, last_step = null, created_at = now();
  return jsonb_build_object('secret', public.base32(v_secret),
    'uri', 'otpauth://totp/ConsolFlora:' || replace(v_email, '@', '%40') || '?secret=' || public.base32(v_secret) || '&issuer=ConsolFlora&digits=6&period=30');
end;
$$;

-- Checks a code from the authenticator app (the current step, or one either side for clock drift).
create or replace function public.verify_totp(p_code text, p_remember boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v two_factor_totp%rowtype;
  v_now bigint := floor(extract(epoch from clock_timestamp()) / 30);
  v_step bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if public.too_many_two_factor_failures(auth.uid()) then raise exception 'Too many wrong codes. Wait 15 minutes and try again.'; end if;
  select * into v from two_factor_totp where user_id = auth.uid();
  if not found then raise exception 'Set up your authenticator app first.'; end if;
  select s into v_step from generate_series(v_now - 1, v_now + 1) s
  where public.totp_code(v.secret, s) = btrim(coalesce(p_code, '')) and s > coalesce(v.last_step, -1)
  limit 1;
  if v_step is null then
    -- Returned, not raised, so the failed attempt is kept (an error would undo it).
    insert into two_factor_failures (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'That code is not right. Use the newest 6-digit code from your authenticator app.');
  end if;
  update two_factor_totp set last_step = v_step, confirmed_at = coalesce(confirmed_at, now()) where user_id = auth.uid();
  return jsonb_build_object('ok', true, 'device_token', public.two_factor_pass('totp', p_remember));
end;
$$;

-- Email: a 6-digit code to the account's email, valid 10 minutes.
create or replace function public.send_two_factor_email()
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_code text := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_email text := (select email from auth.users where id = auth.uid());
  v_demo boolean := (select demo_show_email_codes from security_settings);
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not ((select enabled from mail_settings) or v_demo) then
    raise exception 'Email codes start working once the ConsolFlora mailbox is connected. Use an authenticator app for now.';
  end if;
  if exists (select 1 from two_factor_email_codes where user_id = auth.uid() and expires_at > now() + interval '9 minutes 30 seconds') then
    raise exception 'A code was just sent. Wait a few seconds before asking for another.';
  end if;
  insert into two_factor_email_codes (user_id, code_hash, expires_at)
  values (auth.uid(), encode(digest(v_code || auth.uid()::text, 'sha256'), 'hex'), now() + interval '10 minutes')
  on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0;
  -- Queued for the mail sender (built with the email item).
  perform public.notify_email_code(auth.uid(), v_email, v_code);
  return jsonb_build_object('sent_to', regexp_replace(v_email, '^(.).*(@.*)$', '\1•••\2'), 'demo_code', case when v_demo then v_code end);
end;
$$;

create table public.email_outbox (
  id bigserial primary key,
  to_address text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.email_outbox enable row level security; -- the mail sender uses the service role

create or replace function public.notify_email_code(p_user_id uuid, p_email text, p_code text)
returns void
language sql security definer set search_path = public
as $$
  -- In production the code is only in the email. On the preview (no mailbox) nothing is queued.
  insert into email_outbox (to_address, subject, body)
  select p_email, 'Your ConsolFlora sign-in code', 'Your ConsolFlora sign-in code is ' || p_code || '. It works for 10 minutes. If you did not try to sign in, tell your Admin.'
  where (select enabled from mail_settings)
$$;
revoke execute on function public.notify_email_code(uuid, text, text) from public, anon, authenticated;

create or replace function public.verify_email_code(p_code text, p_remember boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v two_factor_email_codes%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if public.too_many_two_factor_failures(auth.uid()) then raise exception 'Too many wrong codes. Wait 15 minutes and try again.'; end if;
  select * into v from two_factor_email_codes where user_id = auth.uid();
  if not found or v.expires_at < now() then raise exception 'That code has expired. Ask for a new one.'; end if;
  if v.code_hash <> encode(digest(btrim(coalesce(p_code, '')) || auth.uid()::text, 'sha256'), 'hex') then
    insert into two_factor_failures (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'That code is not right. Check the newest email from ConsolFlora.');
  end if;
  delete from two_factor_email_codes where user_id = auth.uid();
  return jsonb_build_object('ok', true, 'device_token', public.two_factor_pass('email', p_remember));
end;
$$;

-- A device remembered within the last 30 days skips the code.
create or replace function public.use_remembered_device(p_token text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id bigint;
begin
  if auth.uid() is null or public.current_session_id() is null or coalesce(p_token, '') = '' then return false; end if;
  update two_factor_devices set last_used_at = now()
  where user_id = auth.uid() and token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()
  returning id into v_id;
  if v_id is null then return false; end if;
  insert into two_factor_sessions (session_id, user_id, method) values (public.current_session_id(), auth.uid(), 'device')
  on conflict (session_id) do update set verified_at = now(), method = 'device';
  return true;
end;
$$;

-- My account: stop remembering every device.
create or replace function public.forget_my_devices()
returns int
language sql security definer set search_path = public
as $$
  with d as (delete from two_factor_devices where user_id = auth.uid() returning 1) select count(*)::int from d
$$;

-- Admin: lost phone. Removes the authenticator app and remembered devices; the person sets up again.
create or replace function public.admin_reset_two_factor(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_role('admin') then raise exception 'Only Admin users can reset two-factor sign-in.' using errcode = '42501'; end if;
  delete from two_factor_totp where user_id = p_user_id;
  delete from two_factor_devices where user_id = p_user_id;
  delete from two_factor_sessions where user_id = p_user_id;
  delete from two_factor_failures where user_id = p_user_id;
end;
$$;

-- Users page.
create or replace function public.admin_list_two_factor()
returns table (user_id uuid, required boolean, totp boolean, devices bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role('admin') then raise exception 'Only Admin users can see this.' using errcode = '42501'; end if;
  return query
  select p.id,
         exists (select 1 from user_roles r, security_settings s where r.user_id = p.id and r.role = any (s.two_factor_roles)),
         exists (select 1 from two_factor_totp t where t.user_id = p.id and t.confirmed_at is not null),
         (select count(*) from two_factor_devices d where d.user_id = p.id and d.expires_at > now())
  from profiles p;
end;
$$;

-- ---------------------------------------------------------------------------
-- The role checks: active, agreed to the legal documents, and two-factor done where required.
-- ---------------------------------------------------------------------------
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = _role and p.active and p.legal_ok
  ) and public.two_factor_ok(auth.uid())
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = any (_roles) and p.active and p.legal_ok
  ) and public.two_factor_ok(auth.uid())
$$;
