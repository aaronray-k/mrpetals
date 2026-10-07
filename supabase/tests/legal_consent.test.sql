-- Legal documents and consent. Run with `npm run test:db`.
-- Runs in one transaction that is rolled back, because it puts back the documents run.sh clears.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

\ir helpers.sql

update legal_documents set audience = v.audience
from (values ('terms-of-sale', array['customer']), ('supplier-terms', array['farm']),
             ('terms-of-use', array['admin', 'consolidator', 'finance', 'qc', 'senior_qc']), ('privacy', array['all']), ('cookies', array['all'])) as v (code, audience)
where legal_documents.code = v.code;

insert into auth.users (id, email) values
  ('80000000-0000-0000-0000-00000000000a', 'l-admin@test'), ('80000000-0000-0000-0000-0000000000f1', 'l-farm@test'),
  ('80000000-0000-0000-0000-0000000000b1', 'l-buyer@test');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms) values
  ('LF1', 'L Farm', 'Kenya', 'A', 'a@lf.ke', 'USD', 'Net 15');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, destination_airport) values
  ('LB1', 'L Buyer', 'Japan', 'C', 'c@lb.jp', 'USD', 'FOB', 'Prepaid', 'NRT');
insert into user_roles values
  ('80000000-0000-0000-0000-00000000000a', 'admin'), ('80000000-0000-0000-0000-0000000000f1', 'farm'),
  ('80000000-0000-0000-0000-0000000000b1', 'customer');
update profiles set farm_id = (select id from farms where farm_code = 'LF1') where id = '80000000-0000-0000-0000-0000000000f1';
update profiles set customer_id = (select id from customers where customer_code = 'LB1') where id = '80000000-0000-0000-0000-0000000000b1';

set role authenticated;
-- ---------------------------------------------------------------- Before agreeing
set request.jwt.claim.sub = '80000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select array_agg(code order by code) from my_pending_documents()) = array['cookies', 'privacy', 'terms-of-sale'],
  'a buyer must accept the Terms of sale and the Privacy and Cookie notices');
select pg_temp.check(my_customer_id() is null and not has_role('customer') and (select count(*) from customers) = 0,
  'until then the buyer has no access, even through the API');
set request.jwt.claim.sub = '80000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select array_agg(code order by code) from my_pending_documents()) = array['cookies', 'privacy', 'supplier-terms'],
  'a farm must accept its own Supplier terms');
set request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000a';
select pg_temp.check((select array_agg(code order by code) from my_pending_documents()) = array['cookies', 'privacy', 'terms-of-use'],
  'staff accept the Terms of use');
select pg_temp.check(not is_staff(), 'an Admin who has not agreed is not staff yet');

-- ---------------------------------------------------------------- Agreeing
set request.jwt.claim.sub = '80000000-0000-0000-0000-0000000000b1';
select pg_temp.check_refused($$select accept_documents('[{"code": "privacy", "version": "2026-10-07"}, {"code": "cookies", "version": "2026-10-07"}]')$$,
  'Please read and accept the Terms of sale');
select pg_temp.check_refused($$select accept_documents('[{"code": "terms-of-sale", "version": "2020-01-01"}, {"code": "privacy", "version": "2026-10-07"}, {"code": "cookies", "version": "2026-10-07"}]')$$,
  'has been updated');
select accept_documents('[{"code": "terms-of-sale", "version": "2026-10-07"}, {"code": "privacy", "version": "2026-10-07"}, {"code": "cookies", "version": "2026-10-07"}]', false, 'test-agent');
select pg_temp.check(has_role('customer') and my_customer_id() is not null and (select count(*) from customers) = 1, 'after agreeing the buyer has access');
select pg_temp.check((select count(*) from my_agreements()) = 3 and (select bool_and(version = current_version) from my_agreements()), 'versions and times are recorded');
select pg_temp.check((select marketing_opt_in from profiles where id = auth.uid()) = false, 'marketing stays off unless chosen');
select set_marketing_opt_in(true);
select pg_temp.check((select marketing_opt_in and marketing_updated_at is not null from profiles where id = auth.uid()), 'marketing can be switched on later');
select pg_temp.check_refused($$insert into legal_acceptances (document_code, version) values ('privacy', 'x')$$, 'row-level security');

set request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000a';
select accept_documents('[{"code": "terms-of-use", "version": "2026-10-07"}, {"code": "privacy", "version": "2026-10-07"}, {"code": "cookies", "version": "2026-10-07"}]');
select pg_temp.check(is_staff(), 'the Admin has access after agreeing');
select pg_temp.check((select pending from admin_list_agreements() where user_id = '80000000-0000-0000-0000-0000000000f1') = array['Cookie notice', 'Privacy notice', 'Supplier terms']
  and (select legal_ok from admin_list_agreements() where user_id = '80000000-0000-0000-0000-0000000000b1'), 'Admin sees who has agreed and what is outstanding');
update legal_documents set version = 'x';
select pg_temp.check((select count(*) from legal_documents where version = 'x') = 0, 'documents are changed only by a migration, not through the app');

-- ---------------------------------------------------------------- A new version
reset role;
update legal_documents set version = '2026-11-01' where code = 'terms-of-sale';
set role authenticated;
set request.jwt.claim.sub = '80000000-0000-0000-0000-0000000000b1';
select pg_temp.check(not has_role('customer') and (select array_agg(code) from my_pending_documents()) = array['terms-of-sale'],
  'a new Terms of sale is asked for again, and only that one');
select pg_temp.check(public.has_role('customer') = false, 'with no access meanwhile');
set request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000a';
select pg_temp.check(is_staff(), 'staff are not affected by a new Terms of sale');
-- A new role brings its documents.
reset role;
insert into user_roles values ('80000000-0000-0000-0000-00000000000a', 'farm');
set role authenticated;
select pg_temp.check(not is_staff() and (select array_agg(code) from my_pending_documents()) = array['supplier-terms'], 'a new role brings its terms');
-- Anyone can read the documents list (the public legal pages).
reset role;
set role anon;
select pg_temp.check((select count(*) from legal_documents) = 5, 'the documents list is public');
reset role;
rollback;
