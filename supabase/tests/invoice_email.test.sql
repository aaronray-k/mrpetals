-- Invoice emails: bank accounts per currency, the send log, and who may see the sender settings. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

\ir helpers.sql

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-00000000000a', 'e-admin@test'), ('e0000000-0000-0000-0000-00000000000d', 'e-fin@test'),
  ('e0000000-0000-0000-0000-00000000000c', 'e-cons@test'), ('e0000000-0000-0000-0000-0000000000b1', 'e-buyer@test');
insert into user_roles values
  ('e0000000-0000-0000-0000-00000000000a', 'admin'), ('e0000000-0000-0000-0000-00000000000d', 'finance'),
  ('e0000000-0000-0000-0000-00000000000c', 'consolidator'), ('e0000000-0000-0000-0000-0000000000b1', 'customer');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, destination_airport)
values ('EB1', 'Email Buyer', 'Japan', 'Aiko Tanaka', 'aiko@eb1.jp', 'USD', 'FOB', 'Net 30', 'NRT');
update profiles set customer_id = (select id from customers where customer_code = 'EB1') where id = 'e0000000-0000-0000-0000-0000000000b1';
insert into invoices (kind, customer_id, currency, amount, reference) select 'invoice', id, 'USD', 100, 'E-1' from customers where customer_code = 'EB1';
update mail_settings set from_address = 'sales@consolflora.test', enabled = true;

set role authenticated;
-- ---------------------------------------------------------------- Bank details
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-00000000000d';
select pg_temp.check((select bank_name || ' ' || bank_code || ' ' || branch || ' ' || swift_code from bank_details) = 'NCBA Bank Kenya PLC 07000 EMBAKASI CBAFKENX',
  'one set of bank details, read by Finance for the email');
select pg_temp.check((select string_agg(currency || ':' || account_number, ' ' order by currency) from bank_accounts) = 'EUR:1006587214 KES:1006586988 USD:1006587104',
  'and the account number for each currency');
update bank_accounts set account_number = '999' where currency = 'USD';
update bank_details set swift_code = 'XXXX';
select pg_temp.check((select account_number from bank_accounts where currency = 'USD') = '1006587104' and (select swift_code from bank_details) = 'CBAFKENX', 'Finance cannot change them');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-00000000000a';
update bank_accounts set account_number = '1006587105' where currency = 'USD';
select pg_temp.check((select account_number from bank_accounts where currency = 'USD') = '1006587105', 'an Admin can');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) from bank_accounts) = 0 and (select count(*) from bank_details) = 0, 'buyers see no bank details here');

-- ---------------------------------------------------------------- Sender settings and the send log
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-00000000000c';
select pg_temp.check((select mail_sender() ->> 'from_address') = 'sales@consolflora.test', 'a Consolidator sending an invoice gets the sender settings (no password)');
select pg_temp.check((select mail_sender()::text) not like '%password%', 'no password in them');
select record_invoice_email((select id from invoices where reference = 'E-1'), array['aiko@eb1.jp'], '{}', 'Your invoice', array['INV_2026_00001.pdf'], true);
reset role;
select pg_temp.check((select ok and sent_by = 'e0000000-0000-0000-0000-00000000000c' from invoice_emails) , 'each email is logged with who sent it');
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-0000000000b1';
select pg_temp.check(mail_sender() is null, 'buyers get no sender settings');
select pg_temp.check((select count(*) from invoice_emails) = 0, 'nor the email log');
select pg_temp.check_refused($$select record_invoice_email((select id from invoices limit 1), array['x@y.z'], '{}', 's', '{}', true)$$, 'Only Admin, Consolidator and Finance');
reset role;
rollback;
