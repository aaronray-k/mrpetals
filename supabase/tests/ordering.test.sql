-- Catalog, buyer checkout, approval, cost calculator, partial answers, packing list, standing
-- orders, notifications and the release gate. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir helpers.sql

-- ---------------------------------------------------------------- Setup
insert into auth.users (id, email) values
  ('40000000-0000-0000-0000-00000000000a', 'r-admin@test'), ('40000000-0000-0000-0000-00000000000c', 'r-cons@test'),
  ('40000000-0000-0000-0000-00000000000d', 'r-fin@test'), ('40000000-0000-0000-0000-0000000000f1', 'r-farm1@test'),
  ('40000000-0000-0000-0000-0000000000b1', 'r-buyer1@test'), ('40000000-0000-0000-0000-0000000000b2', 'r-buyer2@test');
insert into user_roles values
  ('40000000-0000-0000-0000-00000000000a', 'admin'), ('40000000-0000-0000-0000-00000000000c', 'consolidator'),
  ('40000000-0000-0000-0000-00000000000d', 'finance'), ('40000000-0000-0000-0000-0000000000f1', 'farm'),
  ('40000000-0000-0000-0000-0000000000b1', 'customer'), ('40000000-0000-0000-0000-0000000000b2', 'customer');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms) values
  ('RF1', 'R Farm One', 'Kenya', 'A', 'a@r1.ke', 'USD', 'Net 15'), ('RF2', 'R Farm Two', 'Kenya', 'B', 'b@r2.ke', 'USD', 'Net 15');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, credit_limit, destination_airport) values
  ('RB1', 'R Buyer Prepaid', 'Japan', 'C', 'c@rb1.jp', 'USD', 'FOB', 'Prepaid', null, 'NRT'),
  ('RB2', 'R Buyer Credit', 'Netherlands', 'D', 'd@rb2.nl', 'USD', 'FOB', 'Net 30', 100, 'AMS');
update profiles set farm_id = (select id from farms where farm_code = 'RF1') where id = '40000000-0000-0000-0000-0000000000f1';
update profiles set customer_id = (select id from customers where customer_code = 'RB1') where id = '40000000-0000-0000-0000-0000000000b1';
update profiles set customer_id = (select id from customers where customer_code = 'RB2') where id = '40000000-0000-0000-0000-0000000000b2';
insert into box_types (box_code, length_cm, width_cm, height_cm) values ('RQB', 100, 25, 15);
insert into products (product_code, flower_type, variety, grade, stem_length_cm, stems_per_bunch) values
  ('RR60', 'Rose', 'R Red', 'A1', 60, 20), ('RR70', 'Rose', 'R Red', 'A1', 70, 20), ('RNOP', 'Rose', 'No Price', 'A1', 60, 20);
insert into pack_rates (product_id, box_type_id, bunches_per_box)
select p.id, b.id, 8 from products p, box_types b where p.product_code in ('RR60', 'RR70', 'RNOP') and b.box_code = 'RQB';
insert into price_list (farm_id, product_id, currency, price_per_stem, valid_from)
select f.id, p.id, 'USD', v.price, '2020-01-01'
from (values ('RF1', 'RR60', 0.30), ('RF2', 'RR60', 0.25), ('RF1', 'RR70', 0.40)) as v (farm, prod, price)
join farms f on f.farm_code = v.farm join products p on p.product_code = v.prod;

create temp table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t select customer_code, id from customers where customer_code in ('RB1', 'RB2');
insert into t select farm_code, id from farms where farm_code in ('RF1', 'RF2');
insert into t select product_code, id from products where product_code in ('RR60', 'RR70', 'RNOP');
create function pg_temp.id(n text) returns uuid language sql stable as $$ select id from t where name = n $$;
create function pg_temp.lines(n int) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('RR60'), 'stems', n, 'bunching', 'custom', 'stems_per_bunch', 10, 'sleeves', true, 'bunch_labels', false)) $$;

-- ---------------------------------------------------------------- Timing
select pg_temp.check(farm_delivery_for('2026-08-10') = '2026-08-08', 'farms deliver 48 hours before the ship date');
select pg_temp.check(earliest_ship_date() >= (now() at time zone 'Africa/Nairobi')::date + 2, 'the earliest ship date is about 72 hours away');
select pg_temp.check(earliest_ship_date() <= (now() at time zone 'Africa/Nairobi')::date + 3, 'and not more');

set role authenticated;
-- ---------------------------------------------------------------- Catalog (buyer)
set request.jwt.claim.sub = '40000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select string_agg(format('%s:%s:%s', stem_length_cm, price_per_stem, farms), ',' order by stem_length_cm) from catalog()) = '60:0.2650:2,70:0.4150:1',
  'the catalog prices each length: cheapest farm plus the FOB margin; products without a farm price are left out');
select pg_temp.check_refused($$select * from catalog(pg_temp.id('RB2'))$$, 'The catalog is for buyers');
select pg_temp.check_refused($$select * from sell_price('FOB', pg_temp.id('RR60'))$$, 'permission denied');
select pg_temp.check((select count(*) from price_list) = 0, 'buyers never see farm prices');

-- ---------------------------------------------------------------- Checkout
set role postgres;
insert into shipments (shipment_ref, flight_no, flight_date, destination_airport) values
  ('RS-SOON', 'EK 1', current_date + 1, 'NRT'), ('RS-OK', 'EK 2', current_date + 10, 'NRT'), ('RS-AMS', 'KQ 3', current_date + 10, 'AMS');
insert into t select shipment_ref, id from shipments where shipment_ref like 'RS-%';
set role authenticated;
select pg_temp.check((select string_agg(shipment_ref, ',') from available_flights()) = 'RS-OK', 'buyers only see open flights to their airport, far enough ahead');
select pg_temp.check_refused($$select place_order(pg_temp.id('RS-SOON'), null, pg_temp.lines(100))$$, 'Orders need 72 hours before the ship date');
select pg_temp.check_refused($$select place_order(null, current_date + 1, pg_temp.lines(100))$$, 'The earliest ship date now is');
select pg_temp.check_refused($$select place_order(pg_temp.id('RS-OK'), null, jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('RR60'), 'stems', 10, 'bunching', 'custom')))$$, 'give the stems per bunch');
select pg_temp.check_refused($$select place_order(pg_temp.id('RS-OK'), null, jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('RNOP'), 'stems', 10)))$$, 'No price yet for RNOP');
create temp table o1 as select place_order(pg_temp.id('RS-OK'), null, pg_temp.lines(1000) || jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('RR70'), 'stems', 160, 'bunching', 'consolflora')), 'Please mix colours') as r;
grant select on o1 to authenticated;
insert into t select 'O1', (r ->> 'order_id')::uuid from o1;
select pg_temp.check((select status || ':' || source || ':' || ship_date || ':' || farm_delivery_date from customer_orders where id = pg_temp.id('O1'))
  = format('submitted:self_order:%s:%s', current_date + 10, current_date + 8), 'a catalog order waits for approval; the farm date is worked out');
select pg_temp.check((select flight_note is not null from customer_orders where id = pg_temp.id('O1')), 'a new buyer is told ConsolFlora may change the flight');
select pg_temp.check((select string_agg(format('%s:%s:%s:%s', bunching, coalesce(stems_per_bunch, 0), quoted_price_per_stem, margin_per_stem), ',' order by line_no)
  from customer_order_lines where order_id = pg_temp.id('O1')) = 'custom:10:0.2650:0.0150,consolflora:0:0.4150:0.0150', 'bunching, the quoted price and the margin are kept per line');
select pg_temp.check((order_progress(pg_temp.id('O1')) ->> 'status') = 'submitted', 'the buyer can follow the order');
select pg_temp.check((select count(*) from notifications) = 0, 'buyers don''t see staff notifications');

set request.jwt.claim.sub = '40000000-0000-0000-0000-0000000000b2';
select pg_temp.check(order_progress(pg_temp.id('O1')) is null, 'other buyers can''t see the order');
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select pg_temp.check_refused($$select place_order(pg_temp.id('RS-OK'), null, pg_temp.lines(10))$$, 'Only buyer accounts');

-- ---------------------------------------------------------------- Approval and the cost calculator (staff)
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) from notifications where kind = 'order_submitted' and order_id = pg_temp.id('O1')) = 1, 'staff are told about new orders');
create function pg_temp.line(n int) returns uuid language sql stable as $$ select id from customer_order_lines where order_id = pg_temp.id('O1') and line_no = n $$;
select pg_temp.check_refused($$select allocate_order_line(pg_temp.line(1), pg_temp.id('RF2'), 600)$$, 'Approve order');
select approve_order(pg_temp.id('O1'));
select pg_temp.check_refused($$select approve_order(pg_temp.id('O1'))$$, 'not waiting for approval');
select pg_temp.check((select string_agg(format('%s:%s:%s:%s', farm_code, cost_per_stem, margin_per_stem, recommended), ',' order by cost_per_stem) from line_farm_options(pg_temp.line(1)))
  = 'RF2:0.2500:0.0150:t,RF1:0.3000:-0.0350:f', 'the calculator lists farms cheapest first and recommends the cheapest');
set role postgres;
insert into price_overrides (product_id, incoterm, pinned_farm_id) values (pg_temp.id('RR60'), 'FOB', pg_temp.id('RF1'));
set role authenticated;
select pg_temp.check((select farm_code from line_farm_options(pg_temp.line(1)) where recommended) = 'RF1', 'an Admin-pinned farm is recommended instead');
select pg_temp.check((select margin_per_stem from line_farm_options(pg_temp.line(1)) where farm_code = 'RF2') = 0.0150, 'the buyer keeps the price they were quoted');
select pg_temp.check_refused($$insert into price_overrides (product_id, incoterm, sell_price_per_stem) values (pg_temp.id('RR70'), 'FOB', 1)$$, 'row-level security');

select allocate_order_line(pg_temp.line(1), pg_temp.id('RF1'), 1000);
select allocate_order_line(pg_temp.line(2), pg_temp.id('RF1'), 160);
insert into t select 'PO1', id from purchase_orders where order_id = pg_temp.id('O1') and farm_id = pg_temp.id('RF1');
select pg_temp.check((select delivery_date from purchase_orders where id = pg_temp.id('PO1')) = current_date + 8, 'the PO carries the farm delivery date');
select send_purchase_order(pg_temp.id('PO1'));

-- ---------------------------------------------------------------- Partial answer (farm)
set request.jwt.claim.sub = '40000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select count(*) from notifications where kind = 'po_sent') = 1, 'the farm is told about the PO');
select pg_temp.check_refused($$select answer_purchase_order(pg_temp.id('PO1'), jsonb_build_array(jsonb_build_object('po_line_id', (select id from purchase_order_lines where po_id = pg_temp.id('PO1') and stems = 1000), 'stems', 1200)))$$, 'give between 0 and 1000 stems');
select pg_temp.check((answer_purchase_order(pg_temp.id('PO1'),
  jsonb_build_array(jsonb_build_object('po_line_id', (select id from purchase_order_lines where po_id = pg_temp.id('PO1') and stems = 1000), 'stems', 600)),
  current_date + 7) ->> 'short_stems') = '400', 'the farm confirms 600 of 1000 stems');
select pg_temp.check((select status || ':' || delivery_date from purchase_orders where id = pg_temp.id('PO1')) = 'confirmed:' || (current_date + 7), 'confirmed, with the farm''s delivery date');
select pg_temp.check((select requested_stems || '>' || stems from purchase_order_lines where po_id = pg_temp.id('PO1') and requested_stems is not null) = '1000>600', 'the line keeps what was asked');

set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select pg_temp.check((select string_agg(format('%s:%s:%s', line_no, confirmed, short), ',' order by line_no) from order_line_coverage where order_id = pg_temp.id('O1')) = '1:600:400,2:160:0', 'the shortfall shows on the order');
select pg_temp.check((select count(*) from notifications where kind = 'po_partial') = 1, 'staff are told the farm was short');
select pg_temp.check_refused($$select create_packing_list(pg_temp.id('O1'))$$, 'line 1 is 400 stems short');
-- ConsolFlora places the rest with the next farm.
select allocate_order_line(pg_temp.line(1), pg_temp.id('RF2'), 400);
insert into t select 'PO2', id from purchase_orders where order_id = pg_temp.id('O1') and farm_id = pg_temp.id('RF2');
select send_purchase_order(pg_temp.id('PO2'));
select respond_purchase_order(pg_temp.id('PO2'), true);
select pg_temp.check(create_packing_list(pg_temp.id('O1')) = 8, 'every confirmed PO becomes boxes in one step: 4 + 1 + 3');
select pg_temp.check((select packing_list_at is not null from customer_orders where id = pg_temp.id('O1')), 'the packing list is marked ready');

set request.jwt.claim.sub = '40000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select (r ->> 'farms_confirmed')::boolean and (r ->> 'boxes')::int = 8 and r ->> 'status' = 'open' from (select order_progress(pg_temp.id('O1')) r) x), 'the buyer sees farms confirmed and boxes made');
select pg_temp.check((select string_agg(kind, ',' order by created_at) from notifications) = 'order_approved,packing_list', 'the buyer is told when it''s approved and when the packing list is ready');
select pg_temp.check((select attachments from notifications where kind = 'packing_list') = '{"proforma": true, "packing_list": true}', 'the email will carry the proforma and packing list');
select mark_notifications_read(array(select id from notifications));
select pg_temp.check((select bool_and(read_at is not null) from notifications), 'buyers mark their notifications read');

-- ---------------------------------------------------------------- Declining
create temp table o2 as select place_order(pg_temp.id('RS-OK'), null, pg_temp.lines(50)) as r;
grant select on o2 to authenticated;
insert into t select 'O2', (r ->> 'order_id')::uuid from o2;
select pg_temp.check((select flight_note from customer_orders where id = pg_temp.id('O2')) is null, 'after an approved order the buyer is no longer new: no flight disclaimer');
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select decline_order(pg_temp.id('O2'), 'No flights to NRT that week');
select pg_temp.check((select status || ':' || decline_reason from customer_orders where id = pg_temp.id('O2')) = 'declined:No flights to NRT that week', 'staff can decline a new order with a reason');
select pg_temp.check_refused($$select decline_order(pg_temp.id('O1'), 'Over limit')$$, 'Only Finance and Admin');
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000d';
select pg_temp.check_refused($$select decline_order(pg_temp.id('O1'), 'Over limit')$$, 'already has boxes');

-- ---------------------------------------------------------------- Payment and credit (Finance)
select pg_temp.check((select is_prepaid from buyer_credit where customer_id = pg_temp.id('RB1')), 'Prepaid buyers are those on Prepaid terms');
select pg_temp.check((select open_value from buyer_credit where customer_id = pg_temp.id('RB1')) = 331.4, 'the order is worth the quoted prices: 600 x 0.265 + 160 x 0.415 + 400 x 0.265');
select pg_temp.check((select string_agg(format('%s:%s', farm_name, margin_per_stem), ',' order by farm_name, margin_per_stem) from order_packing_list where order_id = pg_temp.id('O1'))
  = 'R Farm One:-0.0350,R Farm One:0.0150,R Farm Two:0.0150', 'the packing list margin is quoted price minus each farm''s price');

-- Release gate: documents and the unpaid prepaid order block closing.
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select pg_temp.check((select string_agg(x, ' | ') from unnest(shipment_blockers(pg_temp.id('RS-OK'))) x)
  = 'R Buyer Prepaid: 8 boxes not received yet | R Buyer Prepaid: KEPHIS phytosanitary certificate missing | R Buyer Prepaid: certificate of origin missing | R Buyer Prepaid: prepaid order CFLRB10001 not paid | Shipment: customs export entry missing',
  'the blockers are listed in plain words');
select pg_temp.check_refused($$select close_shipment(pg_temp.id('RS-OK'))$$, 'can''t close yet');
select pg_temp.check_refused($$select close_shipment(pg_temp.id('RS-OK'), 'Flight leaves now')$$, 'Only an Admin can close');
select pg_temp.check_refused($$select mark_order_paid(pg_temp.id('O1'))$$, 'Only Finance and Admin');
select pg_temp.check_refused($$select save_shipment_document(pg_temp.id('RS-OK'), null, 'phyto', 'X', null)$$, 'shipment_documents_check');
create temp table docs as select save_shipment_document(pg_temp.id('RS-OK'), c, d, 'KE-123', null) as id
from (values (pg_temp.id('RB1'), 'phyto'), (pg_temp.id('RB1'), 'certificate_of_origin'), (null, 'export_entry')) as v (c, d);
grant select on docs to authenticated;
select pg_temp.check((select count(*) from unnest(shipment_blockers(pg_temp.id('RS-OK'))) x where x like '%not checked yet') = 3, 'documents still need checking');
select approve_shipment_document(id) from docs;
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000d';
select mark_order_paid(pg_temp.id('O1'), 'TT 2026-118');
select pg_temp.check((select payment_status || ':' || payment_reference from customer_orders where id = pg_temp.id('O1')) = 'paid:TT 2026-118', 'Finance marks the order paid');
select pg_temp.check((select string_agg(x, ' | ') from unnest(shipment_blockers(pg_temp.id('RS-OK'))) x) = 'R Buyer Prepaid: 8 boxes not received yet', 'only the boxes are left');
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select receive_boxes(array(select id from boxes where shipment_id = pg_temp.id('RS-OK')));
select pg_temp.check((select string_agg(x, ' | ') from unnest(shipment_blockers(pg_temp.id('RS-OK'))) x) = 'R Buyer Prepaid: 8 boxes not passed by QC yet', 'received boxes still need QC');
select set_qc_result(array(select id from boxes where shipment_id = pg_temp.id('RS-OK')), true);
select pg_temp.check((select string_agg(x, ' | ') from unnest(shipment_blockers(pg_temp.id('RS-OK'))) x) = 'R Buyer Prepaid: 8 boxes without a label yet', 'and labels');
select count(*) from print_labels(array(select id from boxes where shipment_id = pg_temp.id('RS-OK')));
select pg_temp.check(cardinality(shipment_blockers(pg_temp.id('RS-OK'))) = 0, 'nothing blocks the shipment now');
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select close_shipment(pg_temp.id('RS-OK'));
select pg_temp.check((select status from shipments where id = pg_temp.id('RS-OK')) = 'closed', 'a cleared shipment closes');

-- Credit buyer over the limit: a warning, and Finance can decline.
set request.jwt.claim.sub = '40000000-0000-0000-0000-0000000000b2';
create temp table o3 as select place_order(pg_temp.id('RS-AMS'), null, pg_temp.lines(1000)) as r;
grant select on o3 to authenticated;
insert into t select 'O3', (r ->> 'order_id')::uuid from o3;
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000d';
select pg_temp.check((select over_limit and open_value = 315 from buyer_credit where customer_id = pg_temp.id('RB2')), 'a credit buyer over the limit is flagged (1000 x 0.315 from the pinned farm > 100)');
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select approve_order(pg_temp.id('O3'));
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000d';
select pg_temp.check((select over_credit_limit from shipment_release where shipment_id = pg_temp.id('RS-AMS') and customer_id = pg_temp.id('RB2')), 'and warned about on the shipment');
select pg_temp.check(not exists (select 1 from unnest(shipment_blockers(pg_temp.id('RS-AMS'))) x where x like '%credit%'), 'the credit limit only warns');
select decline_order(pg_temp.id('O3'), 'Over the credit limit');
select pg_temp.check((select open_value from buyer_credit where customer_id = pg_temp.id('RB2')) = 0, 'a declined order no longer counts');

-- Admin closes a blocked shipment with a reason.
set role postgres;
insert into shipments (shipment_ref, flight_date, destination_airport) values ('RS-X', current_date + 12, 'NRT');
insert into t select 'RS-X', id from shipments where shipment_ref = 'RS-X';
set role authenticated;
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
select approve_order(id) from customer_orders where id = pg_temp.id('O2') and false;
insert into t select 'O4', (create_customer_order(pg_temp.id('RB1'), pg_temp.id('RS-X'), null, pg_temp.lines(10)) ->> 'order_id')::uuid;
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000a';
select pg_temp.check_refused($$select close_shipment(pg_temp.id('RS-X'), 'ok')$$, 'Give a reason');
select close_shipment(pg_temp.id('RS-X'), 'Documents travel with the forwarder');
select pg_temp.check((select reason from shipment_overrides where shipment_id = pg_temp.id('RS-X')) = 'Documents travel with the forwarder', 'the override is logged with what it skipped');

-- ---------------------------------------------------------------- Standing orders
set request.jwt.claim.sub = '40000000-0000-0000-0000-0000000000b1';
create temp table so as select save_standing_order(null, null, array[1, 4], pg_temp.lines(320)) as id;
grant select on so to authenticated;
select pg_temp.check((select count(*) from notifications where kind = 'standing_order_changed') = 1, 'the buyer is told the standing order was set up');
select pg_temp.check_refused($$select generate_standing_orders()$$, 'Only ConsolFlora staff');
set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000c';
-- From a Wednesday, 5 days ahead covers Thursday and Monday.
select skip_standing_order_week((select id from so), date '2026-11-09');
select pg_temp.check(generate_standing_orders(date '2026-11-04') = 1, 'orders are made for ship days in the next 5 days, minus skipped weeks');
select pg_temp.check(generate_standing_orders(date '2026-11-04') = 0, 'running it again makes nothing new');
select pg_temp.check((select status || ':' || ship_date || ':' || farm_delivery_date from customer_orders where standing_order_id = (select id from so))
  = 'open:2026-11-05:2026-11-03', 'a standing order''s week starts approved, with the farm date worked out');
select pg_temp.check((select stems || ':' || bunching from customer_order_lines l join customer_orders o on o.id = l.order_id where o.standing_order_id = (select id from so)) = '320:custom', 'with the standing lines');
set request.jwt.claim.sub = '40000000-0000-0000-0000-0000000000b1';
select pg_temp.check_refused($$select skip_standing_order_week((select id from so), date '2026-11-05')$$, 'already with the farms');
select pg_temp.check_refused($$select save_standing_order((select id from so), pg_temp.id('RB2'), array[1], pg_temp.lines(10))$$, 'Only the buyer or ConsolFlora staff');

reset role;
