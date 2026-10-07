-- Service fees (the ConsolFlora rate card). Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
-- One transaction, rolled back: the exchange rate it adds must not reach views_dashboards.test.sql.
begin;

\ir helpers.sql

insert into auth.users (id, email) values
  ('90000000-0000-0000-0000-00000000000c', 's-cons@test'), ('90000000-0000-0000-0000-00000000000d', 's-fin@test'),
  ('90000000-0000-0000-0000-0000000000b1', 's-full@test'), ('90000000-0000-0000-0000-0000000000b2', 's-consol@test');
insert into user_roles values
  ('90000000-0000-0000-0000-00000000000c', 'consolidator'), ('90000000-0000-0000-0000-00000000000d', 'finance'),
  ('90000000-0000-0000-0000-0000000000b1', 'customer'), ('90000000-0000-0000-0000-0000000000b2', 'customer');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms) values
  ('SF1', 'S Farm', 'Kenya', 'A', 'a@sf.ke', 'USD', 'Net 15');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, destination_airport, service) values
  ('SFULL', 'S Full Package', 'Japan', 'C', 'c@sfull.jp', 'USD', 'FOB', 'Net 30', 'NRT', 'full_package'),
  ('SCONS', 'S Consolidation', 'Netherlands', 'D', 'd@scons.nl', 'EUR', 'FOB', 'Net 30', 'AMS', 'consolidation'),
  ('SQC', 'S Intake QC', 'Japan', 'E', 'e@sqc.jp', 'USD', 'FOB', 'Net 30', 'NRT', 'intake_qc');
update profiles set customer_id = (select id from customers where customer_code = 'SFULL') where id = '90000000-0000-0000-0000-0000000000b1';
update profiles set customer_id = (select id from customers where customer_code = 'SCONS') where id = '90000000-0000-0000-0000-0000000000b2';
insert into products (product_code, flower_type, variety, grade, stem_length_cm, stems_per_bunch) values
  ('S40', 'Rose', 'S Forty', 'A1', 40, 20), ('S60', 'Rose', 'S Sixty', 'A1', 60, 20),
  ('S80', 'Rose', 'S Eighty', 'A1', 80, 20), ('S120', 'Rose', 'S Long', 'A1', 120, 10);
insert into price_list (farm_id, product_id, currency, price_per_stem, valid_from)
select f.id, p.id, 'USD', 0.30, '2020-01-01' from farms f, products p where f.farm_code = 'SF1' and p.product_code like 'S%';
insert into exchange_rates (from_currency, to_currency, rate, valid_from) select 'USD', 'EUR', 0.9, '2020-01-01'
where not exists (select 1 from exchange_rates where from_currency = 'USD' and to_currency = 'EUR');
insert into shipments (shipment_ref, flight_date, destination_airport) values ('SS1', current_date + 10, 'NRT'), ('SS2', current_date + 10, 'AMS');
create temp table s (name text primary key, id uuid);
insert into s select 'SS1', id from shipments where shipment_ref = 'SS1';
insert into s select 'SS2', id from shipments where shipment_ref = 'SS2';
grant all on s to authenticated;
create function pg_temp.id(n text) returns uuid language sql stable as $$ select id from s where name = n $$;
create function pg_temp.prod(c text) returns uuid language sql stable as $$ select id from products where product_code = c $$;
create function pg_temp.fees(o uuid) returns text language sql stable as $$
  select coalesce(string_agg(description || '=' || amount, ',' order by description), '') from order_charges where order_id = o and kind = 'service_fee' $$;

-- ---------------------------------------------------------------- The FOB rate card
select pg_temp.check(margin_in('FOB', pg_temp.prod('S40'), 'USD') = 0.01 and margin_in('FOB', pg_temp.prod('S60'), 'USD') = 0.02
  and margin_in('FOB', pg_temp.prod('S80'), 'USD') = 0.025 and margin_in('FOB', pg_temp.prod('S120'), 'USD') = 0.025,
  'FOB per-stem fee: 0.01 for 40/50 cm, 0.02 for 60/70 cm, 0.025 for 80 to 120 cm');
select pg_temp.check(margin_in('FOB', pg_temp.prod('S60'), 'EUR') = 0.02, 'the same figure in euro, not converted');
select pg_temp.check((select string_agg(service || ':' || per_stem || ':' || fee_per_shipment, ',' order by service) from service_fees)
  = 'consolidation:false:80.00,full_package:true:100.00,intake_qc:false:150.00,sourcing:true:0.00', 'the four services and their fees');

set role authenticated;
-- ---------------------------------------------------------------- Full package (USD)
set request.jwt.claim.sub = '90000000-0000-0000-0000-0000000000b1';
select pg_temp.check((my_service() ->> 'service') = 'full_package' and (my_service() ->> 'fee_per_shipment')::numeric = 100, 'the buyer sees their service and fee');
select pg_temp.check((select price_per_stem from catalog() where product_code = 'S60') = 0.32, 'full package: farm price plus the per-stem fee (0.30 + 0.02)');
insert into s select 'F1', (place_order(pg_temp.id('SS1'), null, jsonb_build_array(jsonb_build_object('product_id', pg_temp.prod('S60'), 'stems', 200))) ->> 'order_id')::uuid;
select pg_temp.check(pg_temp.fees(pg_temp.id('F1')) = 'Document consolidation fee (per shipment)=100.00', 'the per-shipment fee is added to the order');
insert into s select 'F2', (place_order(pg_temp.id('SS1'), null, jsonb_build_array(jsonb_build_object('product_id', pg_temp.prod('S80'), 'stems', 100))) ->> 'order_id')::uuid;
select pg_temp.check(pg_temp.fees(pg_temp.id('F2')) = '', 'a second order on the same shipment has no second fee');
-- ---------------------------------------------------------------- Consolidation (EUR)
set request.jwt.claim.sub = '90000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select price_per_stem from catalog() where product_code = 'S60') = 0.27, 'consolidation: the farm price only (0.30 x 0.9), no per-stem fee');
insert into s select 'C1', (place_order(pg_temp.id('SS2'), null, jsonb_build_array(jsonb_build_object('product_id', pg_temp.prod('S60'), 'stems', 200))) ->> 'order_id')::uuid;
select pg_temp.check(pg_temp.fees(pg_temp.id('C1')) = 'Document consolidation fee (per shipment)=80.00', 'the consolidation fee, the same figure in euro');
select pg_temp.check((select margin_per_stem from customer_order_lines where order_id = pg_temp.id('C1')) = 0, 'and no per-stem fee on the line');
select pg_temp.check((select count(*) from service_fees) = 0, 'buyers do not read the fee table');

-- ---------------------------------------------------------------- Moving the fee
set request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000c';
select decline_order(pg_temp.id('F1'), 'Changed plans');
select pg_temp.check(pg_temp.fees(pg_temp.id('F1')) = '' and pg_temp.fees(pg_temp.id('F2')) = 'Document consolidation fee (per shipment)=100.00',
  'when the order with the fee is declined, the fee moves to the buyer''s other order on the shipment');
select decline_order(pg_temp.id('F2'), 'Changed plans');
select pg_temp.check((select count(*) from order_charges c join customer_orders o on o.id = c.order_id
  where c.kind = 'service_fee' and o.customer_id = (select id from customers where customer_code = 'SFULL')) = 0, 'no orders left, no fee');
-- Staff-entered orders follow the service too.
select pg_temp.check((create_customer_order((select id from customers where customer_code = 'SQC'), pg_temp.id('SS1'), null,
  jsonb_build_array(jsonb_build_object('product_id', pg_temp.prod('S60'), 'stems', 100))) ->> 'order_id') is not null, 'staff enter an order');
select pg_temp.check((select string_agg(pg_temp.fees(o.id) || '|' || l.margin_per_stem, ',') from customer_orders o join customer_order_lines l on l.order_id = o.id
  where o.customer_id = (select id from customers where customer_code = 'SQC')) = 'Intake and quality checks (per shipment)=150.00|0.0000',
  'intake and quality checks: 150 per shipment, no per-stem fee');

-- ---------------------------------------------------------------- Who changes the fees
select pg_temp.check((select count(*) from service_fees) = 4, 'staff read the fee table');
update service_fees set fee_per_shipment = 999 where service = 'consolidation';
select pg_temp.check((select fee_per_shipment from service_fees where service = 'consolidation') = 80, 'a Consolidator cannot change fees');
set request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000d';
update service_fees set fee_per_shipment = 90 where service = 'consolidation';
select pg_temp.check((select fee_per_shipment from service_fees where service = 'consolidation') = 90, 'Finance can');
update service_fees set fee_per_shipment = 80 where service = 'consolidation';
reset role;
rollback;
