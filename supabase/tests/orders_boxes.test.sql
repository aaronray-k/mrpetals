-- Orders, farm POs, boxes, numbering, printing and access. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir helpers.sql

-- ---------------------------------------------------------------- Setup (as the database owner)
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-00000000000a', 'o-admin@test'),
  ('20000000-0000-0000-0000-00000000000c', 'o-cons@test'),
  ('20000000-0000-0000-0000-00000000000e', 'o-qc@test'),
  ('20000000-0000-0000-0000-00000000000d', 'o-finance@test'),
  ('20000000-0000-0000-0000-0000000000f1', 'farm-a@test'),
  ('20000000-0000-0000-0000-0000000000f2', 'farm-b@test'),
  ('20000000-0000-0000-0000-0000000000b1', 'buyer-1@test');
insert into user_roles values
  ('20000000-0000-0000-0000-00000000000a', 'admin'), ('20000000-0000-0000-0000-00000000000c', 'consolidator'),
  ('20000000-0000-0000-0000-00000000000e', 'qc'), ('20000000-0000-0000-0000-00000000000d', 'finance'),
  ('20000000-0000-0000-0000-0000000000f1', 'farm'), ('20000000-0000-0000-0000-0000000000f2', 'farm'),
  ('20000000-0000-0000-0000-0000000000b1', 'customer');

insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms) values
  ('FA', 'Farm A', 'Kenya', 'A', 'a@fa.ke', 'USD', 'Net 15'),
  ('FB', 'Farm B', 'Kenya', 'B', 'b@fb.ke', 'USD', 'Net 15');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, destination_airport) values
  ('B1', 'Buyer One', 'Japan', 'C', 'c@b1.jp', 'USD', 'FOB', 'Net 15', 'NRT'),
  ('B2', 'Buyer Two', 'Netherlands', 'D', 'd@b2.nl', 'USD', 'CPT', 'Net 15', 'AMS');
insert into box_types (box_code, length_cm, width_cm, height_cm) values ('OQB', 100, 25, 15), ('OHB', 100, 50, 15);
insert into products (product_code, flower_type, variety, grade, stem_length_cm, stems_per_bunch) values
  ('R70', 'Rose', 'Ever Red', 'A1', 70, 20),
  ('R40', 'Rose', 'Madam Red', 'A1', 40, 25),
  ('P2', 'Rose', 'Two Packs', 'A1', 60, 20);
insert into pack_rates (product_id, box_type_id, bunches_per_box)
select p.id, b.id, v.bunches from (values ('R70', 'OQB', 8), ('R40', 'OQB', 20), ('P2', 'OQB', 10), ('P2', 'OHB', 20)) as v (prod, box, bunches)
join products p on p.product_code = v.prod join box_types b on b.box_code = v.box;
insert into price_list (farm_id, product_id, currency, price_per_stem, valid_from)
select f.id, p.id, 'USD', 0.32, '2026-01-01' from farms f, products p where f.farm_code = 'FA' and p.product_code = 'R70';
update profiles set farm_id = (select id from farms where farm_code = 'FA') where id = '20000000-0000-0000-0000-0000000000f1';
update profiles set farm_id = (select id from farms where farm_code = 'FB') where id = '20000000-0000-0000-0000-0000000000f2';
update profiles set customer_id = (select id from customers where customer_code = 'B1') where id = '20000000-0000-0000-0000-0000000000b1';

create temp table t (name text primary key, id uuid);
create temp table t_box (name text primary key, id bigint);
grant all on t, t_box to authenticated;
insert into t select 'FA', id from farms where farm_code = 'FA';
insert into t select 'FB', id from farms where farm_code = 'FB';
insert into t select 'B1', id from customers where customer_code = 'B1';
insert into t select 'B2', id from customers where customer_code = 'B2';
insert into t select 'R70', id from products where product_code = 'R70';
insert into t select 'R40', id from products where product_code = 'R40';
insert into t select 'P2', id from products where product_code = 'P2';
create function pg_temp.id(n text) returns uuid language sql stable as $$ select id from t where name = n $$;
create function pg_temp.box(n text) returns bigint language sql stable as $$ select id from t_box where name = n $$;

-- ---------------------------------------------------------------- Margins
select pg_temp.check(margin_for('FOB', pg_temp.id('R70')) = 0.015, 'FOB margin from 51 cm is 0.015');
select pg_temp.check(margin_for('FOB', pg_temp.id('R40')) = 0.010, 'FOB margin up to 50 cm is 0.010');
select pg_temp.check(margin_for('CPT', pg_temp.id('R70')) is null, 'no margin without a rule for the incoterm');

set role authenticated;
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000d'; -- Finance
insert into margin_rules (incoterm, flower_type, min_length_cm, max_length_cm, margin_per_stem) values ('FOB', 'rose', 60, 80, 0.02);
select pg_temp.check(margin_for('FOB', pg_temp.id('R70')) = 0.02, 'a rule for the flower type beats the general one');
update margin_rules set active = false where flower_type = 'rose';
select pg_temp.check(margin_for('FOB', pg_temp.id('R70')) = 0.015, 'inactive rules are ignored');
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000c'; -- Consolidator
select pg_temp.check_refused($$insert into margin_rules (incoterm, margin_per_stem) values ('FOB', 1)$$, 'row-level security');

-- ---------------------------------------------------------------- Shipment and orders (Consolidator)
insert into shipments (shipment_ref, flight_no, flight_date, destination_airport) values ('OS1', 'EK 720', '2026-08-03', 'NRT');
insert into shipments (shipment_ref, flight_no, flight_date, destination_airport) values ('OS2', 'EK 722', '2026-08-04', 'NRT');
insert into t select 'S1', id from shipments where shipment_ref = 'OS1';
insert into t select 'S2', id from shipments where shipment_ref = 'OS2';

create temp table t_order as select create_customer_order(pg_temp.id('B1'), pg_temp.id('S1'), '2026-08-01',
  jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('R70'), 'stems', 1000, 'notes', 'Bunching by 3'),
                    jsonb_build_object('product_id', pg_temp.id('R40'), 'stems', 1000))) as r;
insert into t select 'O1', (r ->> 'order_id')::uuid from t_order;
select pg_temp.check((select r ->> 'order_number' from t_order) = 'CFLB10001', 'order numbers are CFL + buyer code + 4 digits');
select pg_temp.check((select string_agg(format('%s:%s:%s', line_no, stems, margin_per_stem), ',' order by line_no) from customer_order_lines where order_id = pg_temp.id('O1')) = '1:1000:0.0150,2:1000:0.0100', 'lines get the FOB margins');
select pg_temp.check(create_customer_order(pg_temp.id('B1'), null, null, jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('R40'), 'stems', 50))) ->> 'order_number' = 'CFLB10002', 'the next order for the buyer is 0002');
insert into t select 'O2', (create_customer_order(pg_temp.id('B2'), pg_temp.id('S1'), '2026-08-01',
  jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('R70'), 'stems', 320))) ->> 'order_id')::uuid;
select pg_temp.check((select margin_per_stem from customer_order_lines where order_id = pg_temp.id('O2')) is null, 'CPT has no margin rule yet: left for staff to set');
select pg_temp.check_refused($$select create_customer_order(pg_temp.id('B1'), null, null, '[{"stems": 10}]')$$, 'the product doesn''t exist');
select pg_temp.check_refused($$select create_customer_order(pg_temp.id('B1'), null, null, '[]')$$, 'at least one line');
select pg_temp.check_refused($$delete from customer_orders$$, 'permission denied');

-- ---------------------------------------------------------------- Split to farms
create function pg_temp.line(o text, n int) returns uuid language sql stable as $$
  select id from customer_order_lines where order_id = pg_temp.id(o) and line_no = n $$;
select allocate_order_line(pg_temp.line('O1', 1), pg_temp.id('FA'), 600);
select allocate_order_line(pg_temp.line('O1', 1), pg_temp.id('FB'), 400);
select allocate_order_line(pg_temp.line('O1', 2), pg_temp.id('FA'), 1000);
select pg_temp.check_refused($$select allocate_order_line(pg_temp.line('O1', 1), pg_temp.id('FB'), 401)$$, 'Only 400 of the 1000 stems');
insert into t select 'PO-A', id from purchase_orders where order_id = pg_temp.id('O1') and farm_id = pg_temp.id('FA');
insert into t select 'PO-B', id from purchase_orders where order_id = pg_temp.id('O1') and farm_id = pg_temp.id('FB');
select pg_temp.check((select bool_and(po_number ~ '^PO-\d{4}-\d{5}$') from purchase_orders), 'PO numbers don''t show the buyer');
select pg_temp.check((select string_agg(format('%s:%s:%s', stems, stems_per_box, coalesce(grower_price_per_stem::text, '-')), ',' order by stems) from purchase_order_lines where po_id = pg_temp.id('PO-A')) = '600:160:0.3200,1000:500:-', 'stems per box from pack rates, grower price from the price list');
select pg_temp.check((select delivery_date from purchase_orders where id = pg_temp.id('PO-A')) = '2026-08-01', 'POs take the order''s delivery date');
select set_grower_price((select id from purchase_order_lines where po_id = pg_temp.id('PO-A') and grower_price_per_stem is null), 0.085);
select pg_temp.check((select count(*) from purchase_order_lines where po_id = pg_temp.id('PO-A') and grower_price_per_stem = 0.085) = 1, 'staff set a missing grower price');
select pg_temp.check_refused($$select set_grower_price((select id from purchase_order_lines limit 1), -1)$$, 'a price of 0 or more');

-- A product with two pack rates needs a box type.
insert into t select 'O3', (create_customer_order(pg_temp.id('B1'), pg_temp.id('S1'), null, jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('P2'), 'stems', 100))) ->> 'order_id')::uuid;
select pg_temp.check_refused($$select allocate_order_line(pg_temp.line('O3', 1), pg_temp.id('FA'), 100)$$, 'Choose a box type');

-- ---------------------------------------------------------------- Send and confirm
select send_purchase_order(pg_temp.id('PO-A'));
select pg_temp.check_refused($$select allocate_order_line(pg_temp.line('O1', 2), pg_temp.id('FA'), 900)$$, 'has been sent to the farm');
select pg_temp.check_refused($$select assign_boxes(pg_temp.id('PO-A'))$$, 'isn''t confirmed by the farm yet');

set request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000f1'; -- Farm A
select pg_temp.check((select count(*) from purchase_orders) = 1, 'a farm sees only its own POs');
select pg_temp.check((select count(*) from purchase_order_lines) = 2, 'a farm sees its PO lines');
select pg_temp.check((select count(*) from customer_orders) = 0, 'a farm does not see buyer orders');
select pg_temp.check((select count(*) from customer_order_lines) = 0, 'a farm does not see order lines or margins');
select pg_temp.check_refused($$select respond_purchase_order(pg_temp.id('PO-B'), true)$$, 'Only the farm or ConsolFlora staff');
select respond_purchase_order(pg_temp.id('PO-A'), true);

set request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000f2'; -- Farm B
select pg_temp.check((select count(*) from purchase_orders) + (select count(*) from purchase_order_lines) = 0, 'a farm does not see draft POs');
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000c';
select send_purchase_order(pg_temp.id('PO-B'));
set request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000f2'; -- Farm B
select pg_temp.check_refused($$select respond_purchase_order(pg_temp.id('PO-B'), false)$$, 'Give a reason for declining');
select respond_purchase_order(pg_temp.id('PO-B'), false, 'No Ever Red this week');
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000c';
select pg_temp.check((select status || ':' || decline_reason from purchase_orders where id = pg_temp.id('PO-B')) = 'declined:No Ever Red this week', 'the decline reason is kept');
select allocate_order_line(pg_temp.line('O1', 1), pg_temp.id('FB'), 400);
select pg_temp.check((select status from purchase_orders where id = pg_temp.id('PO-B')) = 'draft', 'changing a declined PO makes it a draft again');
select send_purchase_order(pg_temp.id('PO-B'));
select respond_purchase_order(pg_temp.id('PO-B'), true); -- staff record the farm's phone confirmation

-- ---------------------------------------------------------------- Boxes and numbering
select pg_temp.check(assign_boxes(pg_temp.id('PO-A')) = 6, '600/160 -> 4 boxes, 1000/500 -> 2 boxes');
select pg_temp.check_refused($$select assign_boxes(pg_temp.id('PO-A'))$$, 'already has its boxes');
select pg_temp.check((select string_agg(stems::text, ',' order by id) from boxes where farm_id = pg_temp.id('FA')) = '160,160,160,120,500,500', 'the last box holds the rest of the stems');
select pg_temp.check((select bool_and(id >= 10000001) from boxes), 'box ids have eight digits');
select pg_temp.check(assign_boxes(pg_temp.id('PO-B')) = 3, '400/160 -> 3 boxes');
select pg_temp.check((select string_agg(format('%s/%s %s/%s', buyer_box_no, buyer_box_total, farm_box_no, farm_box_total), ',' order by id) from boxes where customer_id = pg_temp.id('B1'))
  = '1/9 1/6,2/9 2/6,3/9 3/6,4/9 4/6,5/9 5/6,6/9 6/6,7/9 1/3,8/9 2/3,9/9 3/3', 'Box n of N per buyer, farm box n of N per farm');

-- A second buyer in the same shipment counts from 1.
select allocate_order_line(pg_temp.line('O2', 1), pg_temp.id('FA'), 320);
insert into t select 'PO-2A', id from purchase_orders where order_id = pg_temp.id('O2');
select send_purchase_order(pg_temp.id('PO-2A'));
select respond_purchase_order(pg_temp.id('PO-2A'), true);
select assign_boxes(pg_temp.id('PO-2A'));
select pg_temp.check((select string_agg(format('%s/%s', buyer_box_no, buyer_box_total), ',' order by id) from boxes where customer_id = pg_temp.id('B2')) = '1/2,2/2', 'each buyer has its own numbering');

insert into t_box select 'b1-2', id from boxes where customer_id = pg_temp.id('B1') and buyer_box_no = 2;
insert into t_box select 'b1-3', id from boxes where customer_id = pg_temp.id('B1') and buyer_box_no = 3;
insert into t_box select 'b1-4', id from boxes where customer_id = pg_temp.id('B1') and buyer_box_no = 4;
insert into t_box select 'b1-9', id from boxes where customer_id = pg_temp.id('B1') and buyer_box_no = 9;

-- Voiding closes the gap while the shipment is open; the box keeps its id.
select pg_temp.check_refused($$select void_box(pg_temp.box('b1-2'), '')$$, 'Give a reason for voiding');
select void_box(pg_temp.box('b1-2'), 'Crushed in transport');
select pg_temp.check((select format('%s/%s', buyer_box_no, buyer_box_total) from boxes where id = pg_temp.box('b1-3')) = '2/8', 'later boxes move up after a void');
select pg_temp.check((select buyer_box_no is null and status = 'void' from boxes where id = pg_temp.box('b1-2')), 'a void box has no number');
select pg_temp.check((select format('%s/%s', farm_box_no, farm_box_total) from boxes where id = pg_temp.box('b1-4')) = '3/5', 'farm numbering follows too');

-- Moving an order with boxes to another shipment is refused.
select pg_temp.check_refused($$update customer_orders set shipment_id = pg_temp.id('S2') where id = pg_temp.id('O1')$$, 'already has boxes in its shipment');
-- A new incoterm re-applies margins.
update customer_orders set incoterm = 'FOB' where id = pg_temp.id('O2');
select pg_temp.check((select margin_per_stem from customer_order_lines where order_id = pg_temp.id('O2')) = 0.015, 'changing the incoterm re-applies margins');

-- Nobody writes boxes directly.
select pg_temp.check_refused($$insert into boxes (po_line_id, shipment_id, customer_id, farm_id, product_id, box_type_id, stems) select po_line_id, shipment_id, customer_id, farm_id, product_id, box_type_id, 1 from boxes limit 1$$, 'permission denied');
select pg_temp.check_refused($$update boxes set buyer_box_no = 1$$, 'permission denied');
select pg_temp.check_refused($$delete from boxes$$, 'permission denied');
select pg_temp.check_refused($$update purchase_orders set status = 'confirmed'$$, 'permission denied');

-- ---------------------------------------------------------------- Receive, QC, print
-- Buyer One's own label template (a buyer's template wins over the default one).
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000a';
select save_label_template(null, 'Buyer One label', pg_temp.id('B1'), false, 150, 70, 'rotated',
  '{"version":1,"elements":[{"type":"qr","id":"qr"},{"type":"box_id","id":"box_id"},{"type":"box_count","id":"box_count"}]}');

set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000c';
select pg_temp.check_refused($$select * from print_labels(array[pg_temp.box('b1-3')])$$, 'hasn''t been received');
select pg_temp.check((select receive_boxes(array_agg(id)) from boxes where customer_id = pg_temp.id('B1')) = 8, 'active boxes are received; void ones are skipped');
select pg_temp.check_refused($$select * from print_labels(array[pg_temp.box('b1-3')])$$, 'hasn''t passed QC');

set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000e'; -- QC
select pg_temp.check_refused($$select set_qc_result(array[pg_temp.box('b1-9')], false)$$, 'Say why the boxes failed QC');
select set_qc_result(array[pg_temp.box('b1-9')], false, 'Botrytis on 3 bunches');
select pg_temp.check((select set_qc_result(array_agg(id), true) from boxes where customer_id = pg_temp.id('B1') and id <> pg_temp.box('b1-9') and status = 'active') = 7, 'QC passes the rest');
select pg_temp.check_refused($$select * from print_labels(array[pg_temp.box('b1-9')])$$, 'hasn''t passed QC');
select pg_temp.check_refused($$select * from print_labels(array[pg_temp.box('b1-2')])$$, 'it is void');

create temp table t_print as select * from print_labels(array[pg_temp.box('b1-3'), pg_temp.box('b1-4')]);
select pg_temp.check((select string_agg(format('%s:%s:%s', kind, data ->> 'boxNo', data ->> 'boxTotal'), ',' order by box_id) from t_print) = 'print:2:8,print:3:8', 'QC can print; the label data carries the numbers');
select pg_temp.check((select data ->> 'customerName' || '|' || (data ->> 'stemsPerBox') || '|' || (data ->> 'shipmentRef') from t_print where box_id = pg_temp.box('b1-3')) = 'Buyer One|160|OS1', 'label data comes from the box');
select pg_temp.check((select bool_and(orientation = 'rotated' and width_mm = 150) from t_print), 'the buyer''s template version comes with it');
select pg_temp.check((select count(*) from label_prints where box_id = pg_temp.box('b1-3') and printed_by = auth.uid() and buyer_box_no = 2 and buyer_box_total = 8) = 1, 'the print is logged with its numbers');
select pg_temp.check_refused($$select * from print_labels(array[pg_temp.box('b1-3')])$$, 'was printed before. Give a reason');
select pg_temp.check((select kind from print_labels(array[pg_temp.box('b1-3')], 'Label smudged')) = 'reprint', 'a reprint with a reason');
select pg_temp.check((select reason from label_prints where box_id = pg_temp.box('b1-3') and kind = 'reprint') = 'Label smudged', 'the reprint reason is logged');

-- Printed labels go out of date when numbers change.
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000c';
select pg_temp.check((select bool_or(label_out_of_date) from box_overview) = false, 'printed labels are up to date');
select void_box((select id from boxes where customer_id = pg_temp.id('B1') and buyer_box_no = 1), 'Short delivery');
select pg_temp.check((select string_agg(format('%s:%s', id = pg_temp.box('b1-3'), label_out_of_date), ',' order by id) from box_overview where id in (pg_temp.box('b1-3'), pg_temp.box('b1-4'))) = 't:t,f:t', 'labels whose numbers changed need a reprint');

-- ---------------------------------------------------------------- Close the shipment
select close_shipment(pg_temp.id('S1'));
select pg_temp.check_refused($$select close_shipment(pg_temp.id('S1'))$$, 'already closed');
create temp table t_frozen as select id, buyer_box_no, buyer_box_total from boxes where customer_id = pg_temp.id('B1') and status = 'active';
grant select on t_frozen to authenticated;
select void_box(pg_temp.box('b1-9'), 'Failed QC');
select pg_temp.check((select bool_and(b.buyer_box_no = f.buyer_box_no and b.buyer_box_total = f.buyer_box_total) from boxes b join t_frozen f on f.id = b.id where b.status = 'active'), 'after closing, a void leaves the other numbers alone');
select pg_temp.check_refused($$update customer_orders set shipment_id = pg_temp.id('S1') where id = (select id from customer_orders where order_number = 'CFLB10002')$$, 'That shipment is closed');
select pg_temp.check((select string_agg(format('%s:%s:%s', farm_name, boxes, stems), ',' order by farm_name, stems) from order_packing_list where order_id = pg_temp.id('O1'))
  = 'Farm A:2:280,Farm A:2:1000,Farm B:2:320', 'the packing list counts active boxes and stems per farm');

-- ---------------------------------------------------------------- Other roles
set request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1'; -- Buyer One
select pg_temp.check((select count(*) from customer_orders) = 3, 'a buyer sees its own orders');
select pg_temp.check((select count(*) from boxes) = 9, 'a buyer sees its own boxes');
select pg_temp.check((select count(*) from purchase_orders) = 0, 'a buyer does not see farm POs');
select pg_temp.check((select count(*) from margin_rules) = 0, 'a buyer does not see margins');
select pg_temp.check((select count(*) from shipments) = 1, 'a buyer sees shipments its orders are on');
select pg_temp.check_refused($$select create_customer_order(pg_temp.id('B1'), null, null, '[{"stems": 10}]')$$, 'Only Admin and Consolidator');

set request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000f1'; -- Farm A
select pg_temp.check((select count(*) from boxes) = 8, 'a farm sees its own boxes');
select pg_temp.check((select count(*) from shipments) = 1, 'a farm sees shipments it has boxes on');
select pg_temp.check_refused($$select * from print_labels(array[pg_temp.box('b1-4')])$$, 'Only QC, Admin and Consolidator');
select pg_temp.check_refused($$select assign_boxes(pg_temp.id('PO-A'))$$, 'Only Admin and Consolidator');

set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000d'; -- Finance
select pg_temp.check((select count(*) from customer_orders) = 4 and (select count(*) from purchase_orders) = 3, 'Finance reads orders and POs');
select pg_temp.check_refused($$select void_box(pg_temp.box('b1-4'), 'Finance says no')$$, 'Only Admin and Consolidator');
select pg_temp.check_refused($$select set_qc_result(array[pg_temp.box('b1-4')], true)$$, 'Only QC, Admin and Consolidator');

set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000e'; -- QC
select pg_temp.check_refused($$select receive_boxes(array[pg_temp.box('b1-4')])$$, 'Only Admin and Consolidator');
select pg_temp.check((select count(*) from customers) = 0, 'QC cannot read buyer details');
select pg_temp.check((select count(*) from buyer_directory where customer_code in ('B1', 'B2')) = 2, 'QC can read buyer names');
set request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select count(*) from buyer_directory) = 0, 'farms cannot read buyer names');
set request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select string_agg(customer_code, ',') from buyer_directory) = 'B1', 'a buyer sees only its own name');

reset role;
