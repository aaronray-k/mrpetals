-- User management: listing, roles, links, switching accounts off. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir helpers.sql

insert into auth.users (id, email) values
  ('50000000-0000-0000-0000-00000000000a', 'u-admin@test'), ('50000000-0000-0000-0000-000000000001', 'u-new@test');
insert into user_roles values ('50000000-0000-0000-0000-00000000000a', 'admin');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms)
values ('UF1', 'U Farm', 'Kenya', 'A', 'a@uf.ke', 'USD', 'Net 15');

set role authenticated;
set request.jwt.claim.sub = '50000000-0000-0000-0000-000000000001';
select pg_temp.check_refused($$select * from admin_list_users()$$, 'Only Admin users');
select pg_temp.check_refused($$select admin_set_user(auth.uid(), 'Me', array['admin'])$$, 'Only Admin users');

set request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) from admin_list_users() where email in ('u-admin@test', 'u-new@test')) = 2, 'Admin sees every account');
select pg_temp.check_refused($$select admin_set_user('50000000-0000-0000-0000-000000000001', 'Grace', array['farm'])$$, 'A Farm user needs their farm');
select pg_temp.check_refused($$select admin_set_user('50000000-0000-0000-0000-000000000001', 'Grace', array['wizard'])$$, 'Unknown role: wizard');
select admin_set_user('50000000-0000-0000-0000-000000000001', 'Peter', array['senior_qc']);
select pg_temp.check((select roles from admin_list_users() where email = 'u-new@test') = array['qc', 'senior_qc'], 'Senior QC comes with QC');
select admin_set_user('50000000-0000-0000-0000-000000000001', 'Grace', array['farm'], (select id from farms where farm_code = 'UF1'));
select pg_temp.check((select full_name || ':' || array_to_string(roles, ',') || ':' || (farm_id is not null) from admin_list_users() where email = 'u-new@test') = 'Grace:farm:true', 'roles are replaced and the farm is linked');
select pg_temp.check_refused($$select admin_set_user(auth.uid(), 'Me', array['finance'])$$, 'can''t remove your own Admin role');

-- Switching an account off removes its access at once.
set request.jwt.claim.sub = '50000000-0000-0000-0000-000000000001';
select pg_temp.check(has_role('farm'), 'an active farm user has the role');
set request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
select admin_set_user('50000000-0000-0000-0000-000000000001', 'Grace', array['farm'], (select id from farms where farm_code = 'UF1'), null, false);
set request.jwt.claim.sub = '50000000-0000-0000-0000-000000000001';
select pg_temp.check(not has_role('farm'), 'a switched-off user has no roles');
reset role;
