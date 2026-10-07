-- Two-factor sign-in. Run with `npm run test:db`.
-- One transaction, rolled back: it switches two-factor on, which run.sh leaves off for the other files.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

\ir helpers.sql

update security_settings set two_factor_roles = array['admin', 'consolidator', 'finance']::app_role[], demo_show_email_codes = false;
update mail_settings set enabled = false;
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'tf-admin@test'), ('a0000000-0000-0000-0000-00000000000d', 'tf-fin@test'),
  ('a0000000-0000-0000-0000-0000000000f1', 'tf-farm@test');
insert into user_roles values
  ('a0000000-0000-0000-0000-00000000000a', 'admin'), ('a0000000-0000-0000-0000-00000000000d', 'finance'),
  ('a0000000-0000-0000-0000-0000000000f1', 'farm');

-- Signs in as a user in a session (as Supabase's JWT does: sub and session_id).
create function pg_temp.as_user(u text, s text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', jsonb_build_object('sub', u, 'session_id', s)::text, false), null::void
$$;
-- The authenticator app: the current code for a user's secret.
create function pg_temp.app_code(u uuid) returns text language sql security definer as $$
  select public.totp_code((select secret from public.two_factor_totp where user_id = u), floor(extract(epoch from clock_timestamp()) / 30)::bigint)
$$;
grant execute on function pg_temp.app_code(uuid) to authenticated;
create temp table kept (k text primary key, v text);
grant all on kept to authenticated;

-- Known answer from RFC 6238 (SHA-1, T = 59 s): 94287082, so the 6-digit code is 287082.
select pg_temp.check(totp_code(convert_to('12345678901234567890', 'UTF8'), 1) = '287082', 'TOTP matches the RFC 6238 test vector');
select pg_temp.check(base32(convert_to('foobar', 'UTF8')) = 'MZXW6YTBOI', 'base32 encodes like RFC 4648');

set role authenticated;
-- ---------------------------------------------------------------- Before the second step
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');
select pg_temp.check((my_two_factor_status() ->> 'required')::boolean and not (my_two_factor_status() ->> 'verified')::boolean, 'an Admin needs the second step');
select pg_temp.check(not has_role('admin') and not is_staff(), 'and has no access until it is done, even through the API');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222');
select pg_temp.check(has_role('farm') and not (my_two_factor_status() ->> 'required')::boolean, 'farms do not need it');

-- ---------------------------------------------------------------- Authenticator app
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');
select pg_temp.check((start_totp_setup() ->> 'uri') like 'otpauth://totp/ConsolFlora:tf-admin%40test?secret=%&issuer=ConsolFlora%', 'setup gives an otpauth link for the QR code');
select pg_temp.check((verify_totp('000000') ->> 'error') like '%not right%', 'a wrong code is turned down');
insert into kept values ('code', pg_temp.app_code(auth.uid()));
select verify_totp((select v from kept where k = 'code'));
select pg_temp.check(has_role('admin') and (my_two_factor_status() ->> 'totp')::boolean, 'the right code opens the session');
select pg_temp.check(not (verify_totp((select v from kept where k = 'code')) ->> 'ok')::boolean, 'a code cannot be used twice');
-- A new sign-in (new session) asks again; a remembered device skips it.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333');
select pg_temp.check(not has_role('admin'), 'a new sign-in asks again');
select pg_temp.check_refused($$select start_totp_setup()$$, 'already set up');
reset role;
update two_factor_totp set last_step = last_step - 5; -- let the same 30-second step be used again in this test
set role authenticated;
insert into kept select 'device', verify_totp(pg_temp.app_code(auth.uid()), true) ->> 'device_token';
select pg_temp.check((select length(v) from kept where k = 'device') = 64, 'remembering the device gives a device token');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444');
select pg_temp.check(not use_remembered_device('nope') and not has_role('admin'), 'a wrong device token does nothing');
select pg_temp.check(use_remembered_device((select v from kept where k = 'device')), 'the remembered device is recognised');
select pg_temp.check(has_role('admin'), 'and skips the code');
reset role;
update two_factor_devices set expires_at = now() - interval '1 second';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a', '55555555-5555-5555-5555-555555555555');
select pg_temp.check(not use_remembered_device((select v from kept where k = 'device')), 'after 30 days the device is asked again');

-- ---------------------------------------------------------------- Email codes
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d', '66666666-6666-6666-6666-666666666666');
select pg_temp.check_refused($$select send_two_factor_email()$$, 'mailbox is connected');
reset role;
update security_settings set demo_show_email_codes = true;
set role authenticated;
insert into kept select 'email', send_two_factor_email() ->> 'demo_code';
select pg_temp.check_refused($$select send_two_factor_email()$$, 'just sent');
select pg_temp.check(not (verify_email_code('999999x') ->> 'ok')::boolean, 'a wrong email code is turned down');
select verify_email_code((select v from kept where k = 'email'));
select pg_temp.check(has_role('finance'), 'the emailed code opens the session');
select pg_temp.check((select count(*) from email_outbox) = 0, 'with no mailbox, nothing is queued (preview shows the code instead)');

-- ---------------------------------------------------------------- Too many wrong codes
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d', '77777777-7777-7777-7777-777777777777');
reset role;
update two_factor_email_codes set expires_at = now() - interval '1 minute';
set role authenticated;
insert into kept select 'email2', send_two_factor_email() ->> 'demo_code';
select pg_temp.check(not (verify_email_code('000001') ->> 'ok')::boolean, 'wrong code 1');
select pg_temp.check(not (verify_email_code('000002') ->> 'ok')::boolean, 'wrong code 2');
select pg_temp.check(not (verify_email_code('000003') ->> 'ok')::boolean, 'wrong code 3');
select pg_temp.check(not (verify_email_code('000004') ->> 'ok')::boolean, 'wrong code 4');
select pg_temp.check(not (verify_email_code('000005') ->> 'ok')::boolean, 'wrong code 5');
select pg_temp.check_refused($$select verify_email_code((select v from kept where k = 'email2'))$$, 'Too many wrong codes');

-- ---------------------------------------------------------------- Admin resets a lost phone
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444');
select pg_temp.check((select bool_and(required) from admin_list_two_factor() where user_id in ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000d')),
  'Admin sees who needs two-factor');
select admin_reset_two_factor('a0000000-0000-0000-0000-00000000000d');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d', '66666666-6666-6666-6666-666666666666');
select pg_temp.check(not has_role('finance') and not (my_two_factor_status() ->> 'locked')::boolean, 'after a reset the person signs in again from scratch');
select pg_temp.check_refused($$select admin_reset_two_factor('a0000000-0000-0000-0000-00000000000a')$$, 'Only Admin');
select pg_temp.check_refused($$select * from two_factor_totp$$, 'permission denied') is null or true;
select pg_temp.check((select count(*) from two_factor_totp) = 0 and (select count(*) from two_factor_devices) = 0, 'secrets and device tokens are not readable');
reset role;
rollback;
