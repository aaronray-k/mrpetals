-- Invoices for Odoo: what is pushed, and what comes back. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

\ir helpers.sql

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-00000000000c', 'o-cons@test'), ('c0000000-0000-0000-0000-00000000000d', 'o-fin@test'),
  ('c0000000-0000-0000-0000-0000000000b1', 'o-buyer1@test'), ('c0000000-0000-0000-0000-0000000000b2', 'o-buyer2@test'),
  ('c0000000-0000-0000-0000-0000000000f1', 'o-farm@test');
insert into user_roles values
  ('c0000000-0000-0000-0000-00000000000c', 'consolidator'), ('c0000000-0000-0000-0000-00000000000d', 'finance'),
  ('c0000000-0000-0000-0000-0000000000b1', 'customer'), ('c0000000-0000-0000-0000-0000000000b2', 'customer'),
  ('c0000000-0000-0000-0000-0000000000f1', 'farm');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms) values
  ('OF1', 'Odoo Farm', 'Kenya', 'A', 'a@of.ke', 'USD', 'Net 15');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, destination_airport, service) values
  ('OB1', 'Odoo Buyer USD', 'Japan', 'C', 'c@ob1.jp', 'USD', 'FOB', 'Net 30', 'NRT', 'sourcing'),
  ('OB2', 'Odoo Buyer EUR', 'Netherlands', 'D', 'd@ob2.nl', 'EUR', 'FOB', 'Net 30', 'AMS', 'sourcing');
update profiles set customer_id = (select id from customers where customer_code = 'OB1') where id = 'c0000000-0000-0000-0000-0000000000b1';
update profiles set customer_id = (select id from customers where customer_code = 'OB2') where id = 'c0000000-0000-0000-0000-0000000000b2';
update profiles set farm_id = (select id from farms where farm_code = 'OF1') where id = 'c0000000-0000-0000-0000-0000000000f1';
insert into products (product_code, flower_type, variety, grade, stem_length_cm, stems_per_bunch) values ('OD60', 'Rose', 'Odoo Red', 'A1', 60, 20);
insert into price_list (farm_id, product_id, currency, price_per_stem, valid_from)
select f.id, p.id, 'USD', 0.30, '2020-01-01' from farms f, products p where f.farm_code = 'OF1' and p.product_code = 'OD60';
insert into shipments (shipment_ref, flight_date, destination_airport, mawb, flight_no) values ('ODS1', current_date + 20, 'NRT', '706-12345675', 'KQ 1406');

create temp table t (name text primary key, id uuid);
grant all on t to authenticated;
create function pg_temp.id(n text) returns uuid language sql stable as $$ select id from t where name = n $$;
insert into t select 'S1', id from shipments where shipment_ref = 'ODS1';

-- Two orders for buyer 1 and one for buyer 2 on the same flight.
set role authenticated;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
insert into t select 'A1', (create_customer_order((select id from customers where customer_code = 'OB1'), pg_temp.id('S1'), null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where product_code = 'OD60'), 'stems', 100))) ->> 'order_id')::uuid;
insert into t select 'A2', (create_customer_order((select id from customers where customer_code = 'OB1'), pg_temp.id('S1'), null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where product_code = 'OD60'), 'stems', 200))) ->> 'order_id')::uuid;
insert into t select 'B1', (create_customer_order((select id from customers where customer_code = 'OB2'), pg_temp.id('S1'), null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where product_code = 'OD60'), 'stems', 100))) ->> 'order_id')::uuid;
reset role;
update customer_order_lines set quoted_price_per_stem = 0.50 where order_id in (select id from t where name in ('A1', 'A2', 'B1'));
insert into order_charges (order_id, description, amount) values (pg_temp.id('A1'), 'Data logger', 26);
update shipments set status = 'closed' where id = pg_temp.id('S1');
set role authenticated;

-- ---------------------------------------------------------------- One invoice per buyer per flight
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) from invoices where shipment_id = pg_temp.id('S1')) = 2, 'closing the shipment makes one invoice per buyer');
select pg_temp.check((select amount || ' ' || currency || ' ' || cardinality(order_ids) from invoices where customer_id = (select id from customers where customer_code = 'OB1'))
  = '176.00 USD 2', 'buyer 1: both orders in one total, charges included (300 x 0.50 + 26)');
select pg_temp.check((select reference from invoices where customer_id = (select id from customers where customer_code = 'OB1')) like 'ODS1 / CFLOB1000%, CFLOB1000%',
  'the reference names the flight and the orders');
insert into t select 'I1', id from invoices where customer_id = (select id from customers where customer_code = 'OB1');
select pg_temp.check((select invoice_payload(pg_temp.id('I1')) -> 'partner' ->> 'name') = 'Odoo Buyer USD'
  and (select invoice_payload(pg_temp.id('I1')) ->> 'line_label') = 'Cut Flowers'
  and (select invoice_payload(pg_temp.id('I1'))::text) not like '%0.30%', 'Odoo gets the buyer, "Cut Flowers" and the total; never the farm price');

-- ---------------------------------------------------------------- Push and fetch
select record_odoo_push(pg_temp.id('I1'), true, '{"move_id": 41, "name": "INV/2026/00041", "state": "posted", "payment_state": "not_paid", "amount_due": 176, "partner_id": 7, "url": "https://x.odoo.com/odoo/action-account.action_move_out_invoice_type/41"}');
select pg_temp.check((select status || ':' || odoo_name from invoices where id = pg_temp.id('I1')) = 'pushed:INV/2026/00041', 'the Odoo number is kept');
select pg_temp.check((select odoo_partner_id from customers where customer_code = 'OB1') = 7, 'and the Odoo customer, for next time');
select pg_temp.check((select odoo_source from invoices where id = pg_temp.id('I1')) is null, 'no source given: left empty');
select record_odoo_fetch(pg_temp.id('I1'), '{"name": "INV/2026/00041", "state": "posted", "payment_state": "paid", "amount_due": 0}');
reset role;
select pg_temp.check((select bool_and(payment_status = 'paid' and payment_reference = 'Odoo INV/2026/00041') from customer_orders where id in (pg_temp.id('A1'), pg_temp.id('A2'))),
  'paid in Odoo marks both orders paid');
select pg_temp.check((select string_agg(audience || ':' || kind, ',' order by kind) from notifications where attachments ->> 'invoice_id' = pg_temp.id('I1')::text)
  = 'customer:invoice_issued,finance:invoice_paid', 'the buyer hears of the invoice, Finance of the payment');
set role authenticated;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000d';
select record_odoo_push((select id from invoices where customer_id = (select id from customers where customer_code = 'OB2')), false, '{}', 'Currency EUR is not active in Odoo');
reset role;
select pg_temp.check((select count(*) from notifications where kind = 'odoo_push_failed') >= 1, 'a failed push tells staff why');
set role authenticated;

-- ---------------------------------------------------------------- Credit notes follow
reset role;
insert into claims (claim_number, customer_id, shipment_id, currency, status) values ('CLM-T-1', (select id from customers where customer_code = 'OB1'), pg_temp.id('S1'), 'USD', 'decided');
insert into credit_notes (credit_note_number, claim_id, customer_id, currency, amount)
values ('CN-T-1', (select id from claims where claim_number = 'CLM-T-1'), (select id from customers where customer_code = 'OB1'), 'USD', 12.5);
select pg_temp.check((select kind || ':' || amount || ':' || reference from invoices where credit_note_id is not null) = 'credit_note:12.50:CN-T-1 / claim CLM-T-1',
  'a claim credit note becomes an Odoo credit note');
insert into claims (claim_number, customer_id, shipment_id, currency, status) values ('CLM-T-2', (select id from customers where customer_code = 'OB1'), pg_temp.id('S1'), 'USD', 'decided');
insert into credit_notes (credit_note_number, claim_id, customer_id, currency, amount)
values ('CN-T-2', (select id from claims where claim_number = 'CLM-T-2'), (select id from customers where customer_code = 'OB1'), 'USD', 5);
select pg_temp.check((select count(*) from invoices where kind = 'credit_note') = 2, 'a second claim on the same flight gets its own credit note');
set role authenticated;

-- ---------------------------------------------------------------- Drafts, confirmed from ConsolFlora
reset role;
update odoo_settings set field_map = '{"mawb": "x_studio_mawb", "flight": "x_studio_flight", "proforma": "x_studio_proforma"}', payment_term_map = '{"Net 30": 4}';
set role authenticated;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
insert into t select 'I2', id from invoices where customer_id = (select id from customers where customer_code = 'OB2') and kind = 'invoice';
select pg_temp.check((select invoice_payload(pg_temp.id('I2')) ->> 'mawb') = '706-12345675' and (select invoice_payload(pg_temp.id('I2')) ->> 'flight') = 'KQ 1406'
  and (select invoice_payload(pg_temp.id('I2')) ->> 'proforma') like 'CFLOB2000%' and (select invoice_payload(pg_temp.id('I2')) ->> 'payment_term_id') = '4'
  and (select invoice_payload(pg_temp.id('I2')) -> 'field_map' ->> 'mawb') = 'x_studio_mawb', 'Odoo gets the MAWB, flight, proforma numbers and payment term to fill in');
select pg_temp.check((select invoice_payload(pg_temp.id('I1')) ->> 'proforma') ~ '^CFLOB1000\d, CFLOB1000\d$', 'a buyer''s orders on the flight are all in the proforma field');
select record_odoo_push(pg_temp.id('I2'), true, '{"move_id": 42, "name": "/", "state": "draft", "payment_state": "not_paid", "amount_due": 50, "source": "api"}');
reset role;
select pg_temp.check((select odoo_state || ':' || coalesce(odoo_name, '-') || ':' || (posted_at is null) from invoices where id = pg_temp.id('I2')) = 'draft:-:true', 'it arrives as a draft, without an Odoo number');
select pg_temp.check((select count(*) from notifications where attachments ->> 'invoice_id' = pg_temp.id('I2')::text and kind = 'invoice_issued') = 0, 'the buyer is not told of a draft');
select pg_temp.check((select count(*) from notifications where attachments ->> 'invoice_id' = pg_temp.id('I2')::text and audience = 'finance' and kind = 'invoice_draft') = 1, 'Finance hears there is a draft to confirm');
set role authenticated;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) from invoices) = 0, 'the buyer doesn''t see the draft');
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000d';
select record_odoo_action(pg_temp.id('I2'), 'confirm', true, '{"name": "INV/2026/00042", "state": "posted", "payment_state": "not_paid", "amount_due": 50, "due_date": "2026-12-01"}');
reset role;
select pg_temp.check((select odoo_name || ':' || odoo_state || ':' || odoo_due_date || ':' || (posted_at is not null) from invoices where id = pg_temp.id('I2')) = 'INV/2026/00042:posted:2026-12-01:true',
  'confirming gives it Odoo''s number and due date');
select pg_temp.check((select body from notifications where attachments ->> 'invoice_id' = pg_temp.id('I2')::text and kind = 'invoice_issued') like '%due 01 Dec 2026.',
  'and then the buyer is told, with the due date');
set role authenticated;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) from invoices) = 1, 'now the buyer sees it');
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select record_odoo_action(pg_temp.id('I2'), 'reset', true, '{"name": "INV/2026/00042", "state": "draft", "payment_state": "not_paid", "amount_due": 50}');
select record_odoo_action(pg_temp.id('I2'), 'confirm', true, '{"name": "INV/2026/00042", "state": "posted", "payment_state": "not_paid", "amount_due": 50}');
select record_odoo_action(pg_temp.id('I2'), 'reset', false, '{}', 'This invoice is paid.');
reset role;
select pg_temp.check((select count(*) from notifications where attachments ->> 'invoice_id' = pg_temp.id('I2')::text and kind = 'invoice_issued') = 1, 'confirming again after a reset doesn''t tell the buyer twice');
select pg_temp.check((select string_agg(action || ':' || ok, ',' order by id) from odoo_sync_log where invoice_id = pg_temp.id('I2')) = 'push:false,push:true,confirm:true,reset:true,confirm:true,reset:false',
  'every confirm and reset is in the activity log, refusals included');
set role authenticated;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-0000000000b2';
select pg_temp.check_refused($$select record_odoo_action(pg_temp.id('I2'), 'confirm', true, '{"state": "posted"}')$$, 'Only Admin, Consolidator and Finance');
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000d';

-- ---------------------------------------------------------------- 15th of following month
reset role;
select pg_temp.check(term_due_date('15th of following month', '2026-10-31') = '2026-11-15' and term_due_date('15th of following month', '2026-12-03') = '2027-01-15'
  and term_due_date('Net 30', '2026-10-31') is null, 'the 15th of the month after; other terms are left to Odoo');
update customers set payment_terms = '15th of following month' where customer_code = 'OB1';
update customer_orders set created_at = '2026-10-31 22:30+03' where id = pg_temp.id('A1');
update customer_orders set created_at = '2026-09-02 10:00+03' where id = pg_temp.id('A2');
set role authenticated;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000d';
select pg_temp.check((select invoice_payload(pg_temp.id('I1')) ->> 'due_date') = '2026-11-15' and (select invoice_payload(pg_temp.id('I1')) -> 'payment_term_id') = 'null'::jsonb,
  'a buyer on 15th of following month: due the 15th after the latest order was placed (Nairobi time), no Odoo payment term');
select pg_temp.check((select invoice_payload(pg_temp.id('I2')) -> 'due_date') = 'null'::jsonb and (select invoice_payload(pg_temp.id('I2')) ->> 'payment_term_id') = '4',
  'a buyer on Net 30 keeps the Odoo payment term');
reset role;
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency) values ('OF2', 'Odoo Farm 2', 'Kenya', 'B', 'b@of2.ke', 'USD');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms) values ('OF3', 'Odoo Farm 3', 'Kenya', 'B', 'b@of3.ke', 'USD', '');
update farms set payment_terms = '' where farm_code = 'OF1';
select pg_temp.check((select string_agg(farm_code || ':' || payment_terms, ',' order by farm_code) from farms where farm_code in ('OF1', 'OF2', 'OF3'))
  = 'OF1:Net 15,OF2:15th of following month,OF3:15th of following month', 'new suppliers start on 15th of following month; an empty cell keeps existing terms');
set role authenticated;

-- ---------------------------------------------------------------- Go-live
select pg_temp.check((select send_from from odoo_settings) is null, 'no go-live until sending is switched on');
reset role;
update odoo_settings set enabled = true;
select pg_temp.check((select send_from from odoo_settings) between now() - interval '1 minute' and now(), 'switching sending on sets the go-live moment');
update odoo_settings set enabled = false;
update odoo_settings set enabled = true;
select pg_temp.check((select send_from from odoo_settings) between now() - interval '1 minute' and now(), 'and switching off and on again keeps it');
set role authenticated;

-- ---------------------------------------------------------------- Demo Odoo customer ids are never kept
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
insert into t select 'MD', create_manual_invoice((select id from customers where customer_code = 'OB2'), 'invoice', 'EUR', 'Demo push', '[{"name": "x", "quantity": 1, "price_unit": 5}]');
select record_odoo_push(pg_temp.id('MD'), true, '{"move_id": 99, "name": "/", "state": "draft", "partner_id": 1234, "source": "demo"}');
select pg_temp.check((select odoo_partner_id from customers where customer_code = 'OB2') is distinct from 1234, 'a demo Odoo customer id is not kept for the real Odoo');

-- ---------------------------------------------------------------- Manual invoices
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
insert into t select 'M1', create_manual_invoice((select id from customers where customer_code = 'OB1'), 'invoice', 'USD', 'Boxes and sleeves, October',
  '[{"name": "Sleeves", "quantity": 200, "price_unit": 0.15}, {"name": "Boxes", "quantity": 3, "price_unit": 12.5}]', 'MAN-123', 'CFLOB10009', 'KQ 100', '2026-11-20');
select pg_temp.check((select amount || ':' || manual || ':' || status || ':' || (shipment_id is null) from invoices where id = pg_temp.id('M1')) = '67.50:true:pending:true',
  'a manual invoice: total of its lines, waiting to go to Odoo, no shipment');
select pg_temp.check((select invoice_payload(pg_temp.id('M1')) -> 'lines' -> 1 ->> 'name') = 'Boxes'
  and (select invoice_payload(pg_temp.id('M1')) ->> 'mawb') = 'MAN-123' and (select invoice_payload(pg_temp.id('M1')) ->> 'proforma') = 'CFLOB10009'
  and (select invoice_payload(pg_temp.id('M1')) ->> 'due_date') = '2026-11-20' and (select invoice_payload(pg_temp.id('M1')) -> 'payment_term_id') = 'null'::jsonb,
  'Odoo gets its lines, MAWB, proforma, flight and chosen due date');
select pg_temp.check_refused($$select create_manual_invoice((select id from customers where customer_code = 'OB1'), 'invoice', 'USD', 'x', '[{"name": "", "quantity": 1, "price_unit": 5}]')$$, 'Every line needs a description');
select pg_temp.check_refused($$select create_manual_invoice((select id from customers where customer_code = 'OB1'), 'invoice', 'XYZ', 'x', '[{"name": "a", "quantity": 1, "price_unit": 5}]')$$, 'not on the currency list');
select pg_temp.check_refused($$select create_manual_invoice((select id from customers where customer_code = 'OB1'), 'invoice', 'USD', 'x', '[{"name": "a", "quantity": 1, "price_unit": 0}]')$$, 'more than 0');
select record_odoo_move_action(77, 'confirm', true, 'INV/2026/00077');
reset role;
select pg_temp.check((select message from odoo_sync_log where action = 'confirm' and invoice_id is null order by id desc limit 1) = 'INV/2026/00077 (Odoo #77)',
  'confirming a document made in Odoo is logged');
set role authenticated;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-0000000000b1';
select pg_temp.check_refused($$select create_manual_invoice((select customer_id from invoices limit 1), 'invoice', 'USD', 'x', '[{"name": "a", "quantity": 1, "price_unit": 5}]')$$, 'Only Admin, Consolidator and Finance');
select pg_temp.check_refused($$select record_odoo_move_action(77, 'confirm', true, 'x')$$, 'Only Admin, Consolidator and Finance');
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000d';

-- ---------------------------------------------------------------- Who sees what
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) from invoices) = 1 and (select customer_id from invoices) = (select id from customers where customer_code = 'OB2'), 'a buyer sees only their own invoices');
select pg_temp.check(invoice_payload(pg_temp.id('I1')) is null, 'and no payloads');
select pg_temp.check_refused($$select record_odoo_push(pg_temp.id('I1'), true, '{}')$$, 'Only Admin, Consolidator and Finance');
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select count(*) from invoices) = 0 and (select count(*) from odoo_settings) = 0, 'farms see no invoices or Odoo settings');
reset role;
rollback;
