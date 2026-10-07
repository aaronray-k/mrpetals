-- Buyer currencies and the role dashboards. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir helpers.sql

insert into auth.users (id, email) values
  ('60000000-0000-0000-0000-00000000000a', 'd-admin@test'), ('60000000-0000-0000-0000-00000000000c', 'd-cons@test'),
  ('60000000-0000-0000-0000-00000000000d', 'd-fin@test'), ('60000000-0000-0000-0000-00000000000e', 'd-qc@test'),
  ('60000000-0000-0000-0000-0000000000f1', 'd-farm@test'), ('60000000-0000-0000-0000-0000000000b1', 'd-buyer-eur@test');
insert into user_roles values
  ('60000000-0000-0000-0000-00000000000a', 'admin'), ('60000000-0000-0000-0000-00000000000c', 'consolidator'),
  ('60000000-0000-0000-0000-00000000000d', 'finance'), ('60000000-0000-0000-0000-00000000000e', 'qc'),
  ('60000000-0000-0000-0000-0000000000f1', 'farm'), ('60000000-0000-0000-0000-0000000000b1', 'customer');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms) values
  ('DF1', 'D Farm', 'Kenya', 'A', 'a@df.ke', 'USD', 'Net 15');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, credit_limit, destination_airport) values
  ('DEU', 'D Euro Buyer', 'Netherlands', 'C', 'c@deu.nl', 'EUR', 'FOB', 'Net 30', 50, 'AMS');
update profiles set farm_id = (select id from farms where farm_code = 'DF1') where id = '60000000-0000-0000-0000-0000000000f1';
update profiles set customer_id = (select id from customers where customer_code = 'DEU') where id = '60000000-0000-0000-0000-0000000000b1';
insert into box_types (box_code, length_cm, width_cm, height_cm) values ('DQB', 100, 25, 15);
insert into products (product_code, flower_type, variety, grade, stem_length_cm, stems_per_bunch) values ('D60', 'Rose', 'D Red', 'A1', 60, 20);
insert into pack_rates (product_id, box_type_id, bunches_per_box) select p.id, b.id, 8 from products p, box_types b where p.product_code = 'D60' and b.box_code = 'DQB';
insert into price_list (farm_id, product_id, currency, price_per_stem, valid_from)
select f.id, p.id, 'USD', 0.30, '2020-01-01' from farms f, products p where f.farm_code = 'DF1' and p.product_code = 'D60';
insert into shipments (shipment_ref, flight_date, destination_airport) values ('DS1', current_date + 10, 'AMS');
create temp table flight as select id from shipments where shipment_ref = 'DS1';
grant select on flight to authenticated;

set role authenticated;
-- ---------------------------------------------------------------- Currency
set request.jwt.claim.sub = '60000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) from catalog() where product_code = 'D60') = 0, 'without a USD to EUR rate, a euro buyer sees no price rather than a wrong one');
set request.jwt.claim.sub = '60000000-0000-0000-0000-00000000000d';
select pg_temp.check((select dashboard_finance() -> 'actions' -> 'missing_rates') @> '[{"from": "USD", "to": "EUR"}]', 'Finance is told the rate is missing');
insert into exchange_rates (from_currency, to_currency, rate, valid_from) values ('USD', 'EUR', 0.9, '2020-01-01');
set request.jwt.claim.sub = '60000000-0000-0000-0000-00000000000c';
select pg_temp.check_refused($$insert into exchange_rates (from_currency, to_currency, rate) values ('EUR', 'USD', 1.1)$$, 'row-level security');
set request.jwt.claim.sub = '60000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select price_per_stem || ' ' || currency from catalog() where product_code = 'D60') = '0.2835 EUR',
  'the euro catalog converts both the farm price and the USD margin: (0.30 + 0.015) x 0.9');
create temp table o as select place_order((select id from flight), null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where product_code = 'D60'), 'stems', 320))) as r;
select pg_temp.check((select currency || ':' || margin_per_stem || ':' || quoted_price_per_stem from customer_orders o join customer_order_lines l on l.order_id = o.id
  where o.id = (select (r ->> 'order_id')::uuid from o)) = 'EUR:0.0135:0.2835', 'the order, its margin and its quoted price are all in euro');
grant select on o to authenticated;

-- ---------------------------------------------------------------- Dashboards
select pg_temp.check((dashboard_buyer() ->> 'currency') = 'EUR' and (dashboard_buyer() -> 'actions' -> 'waiting_approval' -> 0 ->> 'order_number') like 'CFLDEU%',
  'the buyer dashboard is in euro and lists the order waiting for approval');
select pg_temp.check(jsonb_array_length(dashboard_buyer(8) -> 'stems_per_week') = 8 and jsonb_array_length(dashboard_buyer(26) -> 'stems_per_week') = 26, '8 weeks by default, 6 months on request');
select pg_temp.check(((dashboard_buyer() -> 'tiles' ->> 'spend_in_period')::numeric) = 90.72, 'spend in the buyer''s currency: 320 x 0.2835');
select pg_temp.check_refused($$select dashboard_staff()$$, 'Admin and Consolidator');
select pg_temp.check_refused($$select dashboard_finance()$$, 'Finance and Admin');
select pg_temp.check_refused($$select dashboard_farm()$$, 'farm users');

set request.jwt.claim.sub = '60000000-0000-0000-0000-00000000000c';
select pg_temp.check((select bool_or(x ->> 'buyer' = 'D Euro Buyer') from jsonb_array_elements(dashboard_staff() -> 'actions' -> 'to_approve') x), 'staff see the order to approve');
select pg_temp.check((select bool_or(x ->> 'company_name' = 'D Euro Buyer' and x ->> 'currency' = 'EUR' and jsonb_array_length(x -> 'orders') = 1)
  from jsonb_array_elements(dashboard_staff() -> 'buyers') x), 'staff see orders grouped by buyer, with the buyer''s currency');
select approve_order((r ->> 'order_id')::uuid) from o;
select allocate_order_line((select id from customer_order_lines where order_id = (select (r ->> 'order_id')::uuid from o)), (select id from farms where farm_code = 'DF1'), 320);
select send_purchase_order(id) from purchase_orders where order_id = (select (r ->> 'order_id')::uuid from o);
select pg_temp.check((select bool_or((x ->> 'short')::int = 0) is not true from jsonb_array_elements(dashboard_staff() -> 'actions' -> 'short_lines') x where x ->> 'buyer' = 'D Euro Buyer'), 'no shortfall once placed');

set request.jwt.claim.sub = '60000000-0000-0000-0000-0000000000f1';
select pg_temp.check(jsonb_array_length(dashboard_farm() -> 'actions' -> 'to_answer') = 1, 'the farm sees the PO to answer');
select answer_purchase_order(id, (select jsonb_agg(jsonb_build_object('po_line_id', pl.id, 'stems', 160)) from purchase_order_lines pl where pl.po_id = po.id))
from purchase_orders po where po.farm_id = (select id from farms where farm_code = 'DF1') and po.status = 'sent';
select pg_temp.check(((dashboard_farm() -> 'tiles' ->> 'stems_confirmed')::int) = 160, 'the farm''s confirmed stems count');

set request.jwt.claim.sub = '60000000-0000-0000-0000-00000000000c';
select pg_temp.check((select (x ->> 'short')::int from jsonb_array_elements(dashboard_staff() -> 'actions' -> 'short_lines') x where x ->> 'buyer' = 'D Euro Buyer') = 160,
  'the shortfall after a partial answer is an action for staff');
select pg_temp.check((select (x ->> 'asked')::int || '/' || (x ->> 'confirmed')::int from jsonb_array_elements(dashboard_staff() -> 'fill_rate_by_farm') x where x ->> 'farm' = 'D Farm') = '320/160',
  'fill rate per farm: 160 of 320 confirmed');
select pg_temp.check((select (x ->> 'margin')::numeric from jsonb_array_elements(dashboard_staff() -> 'margin_per_week') x
  where x ->> 'currency' = 'EUR' and (x ->> 'week')::date = date_trunc('week', current_date)::date) = 2.16, 'margin in euro: 160 x (0.2835 - 0.30 x 0.9)');

set request.jwt.claim.sub = '60000000-0000-0000-0000-00000000000d';
select pg_temp.check((select (x ->> 'open_value')::numeric from jsonb_array_elements(dashboard_finance() -> 'credit') x where x ->> 'buyer' = 'D Euro Buyer') = 90.72,
  'Finance sees open value against the credit limit, in euro');
select pg_temp.check((select x ->> 'buyer' from jsonb_array_elements(dashboard_finance() -> 'actions' -> 'over_limit') x where x ->> 'buyer' = 'D Euro Buyer') is not null,
  'and the buyer over the limit (90.72 > 50)');
select pg_temp.check(not ((dashboard_finance() -> 'actions' -> 'missing_rates') @> '[{"from": "USD", "to": "EUR"}]'), 'the missing-rate warning is gone');

set request.jwt.claim.sub = '60000000-0000-0000-0000-00000000000e';
select pg_temp.check(dashboard_qc() ? 'pass_rate_by_farm' and dashboard_qc() -> 'tiles' ? 'major_open', 'QC has its dashboard');
select pg_temp.check_refused($$select dashboard_buyer()$$, 'for buyers');

set request.jwt.claim.sub = '60000000-0000-0000-0000-00000000000a';
update mail_settings set from_address = 'orders@consolflora.com', smtp_user = 'orders@consolflora.com';
select pg_temp.check((select enabled = false and smtp_host = 'smtp.zoho.com' and from_address = 'orders@consolflora.com' from mail_settings), 'Admin keeps the Zoho details; email stays off');
set request.jwt.claim.sub = '60000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) from mail_settings) = 0, 'only Admin sees the email settings');
reset role;
