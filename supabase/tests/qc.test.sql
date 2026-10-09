-- QC scanning, results, BACK TO FARM, photos and access. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir helpers.sql

-- ---------------------------------------------------------------- Setup (as the database owner)
insert into auth.users (id, email) values
  ('30000000-0000-0000-0000-00000000000c', 'q-cons@test'),
  ('30000000-0000-0000-0000-00000000000e', 'q-qc@test'),
  ('30000000-0000-0000-0000-0000000000e5', 'q-senior@test'),
  ('30000000-0000-0000-0000-00000000000d', 'q-finance@test'),
  ('30000000-0000-0000-0000-0000000000f1', 'q-farm@test');
insert into user_roles values
  ('30000000-0000-0000-0000-00000000000c', 'consolidator'), ('30000000-0000-0000-0000-00000000000e', 'qc'),
  ('30000000-0000-0000-0000-0000000000e5', 'qc'), ('30000000-0000-0000-0000-0000000000e5', 'senior_qc'),
  ('30000000-0000-0000-0000-00000000000d', 'finance'), ('30000000-0000-0000-0000-0000000000f1', 'farm');
update profiles set full_name = 'Wanjiru QC' where id = '30000000-0000-0000-0000-00000000000e';

insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms)
values ('QFA', 'Q Farm', 'Kenya', 'A', 'a@qfa.ke', 'USD', 'Net 15');
update profiles set farm_id = (select id from farms where farm_code = 'QFA') where id = '30000000-0000-0000-0000-0000000000f1';
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, destination_airport)
values ('QB1', 'Q Buyer', 'Japan', 'C', 'c@qb.jp', 'USD', 'FOB', 'Net 15', 'NRT');
insert into box_types (box_code, length_cm, width_cm, height_cm) values ('QQB', 100, 25, 15);
insert into products (product_code, flower_type, variety, grade, stem_length_cm, stems_per_bunch) values ('Q70', 'Rose', 'Q Red', 'A1', 70, 20);
insert into pack_rates (product_id, box_type_id, bunches_per_box)
select p.id, b.id, 8 from products p, box_types b where p.product_code = 'Q70' and b.box_code = 'QQB';

create temp table t (name text primary key, id uuid);
create temp table t_box (name text primary key, id bigint);
grant all on t, t_box to authenticated;
create function pg_temp.id(n text) returns uuid language sql stable as $$ select id from t where name = n $$;
create function pg_temp.box(n text) returns bigint language sql stable as $$ select id from t_box where name = n $$;
create function pg_temp.status(n text) returns text language sql stable as $$
  select format('%s:%s:%s:%s', status, qc_status, coalesce(qc_severity, '-'), coalesce(buyer_box_no::text, '-') || '/' || coalesce(buyer_box_total::text, '-'))
  from boxes where id = pg_temp.box(n) $$;

set role authenticated;
set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000c'; -- Consolidator
insert into shipments (shipment_ref, destination_airport) values ('QS1', 'NRT'), ('QS2', 'NRT');
insert into t select shipment_ref, id from shipments where shipment_ref in ('QS1', 'QS2');
insert into t select 'O', (create_customer_order((select id from customers where customer_code = 'QB1'), pg_temp.id('QS1'), null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where product_code = 'Q70'), 'stems', 640))) ->> 'order_id')::uuid;
select allocate_order_line((select id from customer_order_lines where order_id = pg_temp.id('O')), (select id from farms where farm_code = 'QFA'), 640);
insert into t select 'PO', id from purchase_orders where order_id = pg_temp.id('O');
select send_purchase_order(pg_temp.id('PO'));
select respond_purchase_order(pg_temp.id('PO'), true);
select pg_temp.check(assign_boxes(pg_temp.id('PO')) = 4, '640 stems at 160 a box make 4 boxes');
insert into t_box select 'b' || buyer_box_no, id from boxes where shipment_id = pg_temp.id('QS1');

-- ---------------------------------------------------------------- Scanning (QC)
set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000e';
create temp table scan1 as select qc_scan('00000000-0000-0000-0000-000000000001', pg_temp.id('QS1'), pg_temp.box('b1')) as r;
select pg_temp.check((select r ->> 'buyer_box_no' = '1' and r ->> 'buyer_box_total' = '4' and r ->> 'customer_name' = 'Q Buyer' and (r ->> 'scanned_before')::boolean = false from scan1), 'a scan returns the box and its number');
select pg_temp.check((select received_at is not null from boxes where id = pg_temp.box('b1')), 'scanning marks the box received');
select qc_scan('00000000-0000-0000-0000-000000000001', pg_temp.id('QS1'), pg_temp.box('b1'));
select pg_temp.check((select count(*) from qc_events where box_id = pg_temp.box('b1')) = 1, 'a scan sent twice is recorded once');
select pg_temp.check((qc_scan('00000000-0000-0000-0000-000000000002', pg_temp.id('QS1'), pg_temp.box('b1')) ->> 'scanned_before')::boolean, 'a second scan says the box was scanned before');
select pg_temp.check_refused($$select qc_scan(gen_random_uuid(), pg_temp.id('QS2'), pg_temp.box('b1'))$$, 'belongs to shipment QS1, not this one');
select pg_temp.check_refused($$select qc_scan(gen_random_uuid(), pg_temp.id('QS1'), 99999999)$$, 'is not in ConsolFlora''s records');
select pg_temp.check_refused($$select qc_record(gen_random_uuid(), array[pg_temp.box('b2')], 'pass')$$, 'hasn''t been received yet');
select qc_scan(gen_random_uuid(), pg_temp.id('QS1'), pg_temp.box('b2'));
select qc_scan(gen_random_uuid(), pg_temp.id('QS1'), pg_temp.box('b3'));
select qc_scan(gen_random_uuid(), pg_temp.id('QS1'), pg_temp.box('b4'));
select pg_temp.check((select bool_and(scanned) from box_overview where shipment_id = pg_temp.id('QS1')), 'the packing list shows every box scanned');

-- ---------------------------------------------------------------- Results
select pg_temp.check_refused($$select qc_record(gen_random_uuid(), array[pg_temp.box('b1')], 'minor')$$, 'at least one reason');
select pg_temp.check_refused($$select qc_record(gen_random_uuid(), array[pg_temp.box('b1')], 'minor', array['other'])$$, 'Add a note for: Other');
select pg_temp.check_refused($$select qc_record(gen_random_uuid(), array[pg_temp.box('b1')], 'major', array['pests'])$$, 'Pests or insects always means BACK TO FARM');
select pg_temp.check_refused($$select qc_record(gen_random_uuid(), array[pg_temp.box('b1')], 'minor', array['rain'])$$, 'Unknown QC reason: rain');
select qc_record(gen_random_uuid(), array[pg_temp.box('b1')], 'minor', array['foliage'], 'Some yellow leaves');
select pg_temp.check(pg_temp.status('b1') = 'active:passed:minor:1/4', 'Minor passes with its reason');
select qc_record(gen_random_uuid(), array[pg_temp.box('b2')], 'major', array['botrytis', 'packaging']);
select pg_temp.check(pg_temp.status('b2') = 'active:failed:major:2/4', 'Major fails the box but keeps it on the shipment');
select pg_temp.check((select qc_reasons = array['botrytis', 'packaging'] from boxes where id = pg_temp.box('b2')), 'the reasons are kept');
select pg_temp.check_refused($$select qc_record(gen_random_uuid(), array[pg_temp.box('b2')], 'pass')$$, 'Only a Senior QC or an Admin can clear it');
select pg_temp.check_refused($$select set_qc_result(array[pg_temp.box('b2')], true)$$, 'Only a Senior QC or an Admin can clear it');
select qc_record(gen_random_uuid(), array[pg_temp.box('b2')], 'major', array['botrytis'], 'Still wet after re-pack');
select pg_temp.check(pg_temp.status('b2') = 'active:failed:major:2/4', 'QC can record Major again');

set request.jwt.claim.sub = '30000000-0000-0000-0000-0000000000e5'; -- Senior QC
select qc_record(gen_random_uuid(), array[pg_temp.box('b2')], 'pass', array['botrytis'], 'Re-packed, dry');
select pg_temp.check(pg_temp.status('b2') = 'active:passed:-:2/4', 'Senior QC clears a Major failure');
select pg_temp.check((select qc_reasons = '{}' from boxes where id = pg_temp.box('b2')), 'a pass has no reasons');

-- Critical: BACK TO FARM. Later boxes move up while the shipment is open.
set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000e';
select pg_temp.check(qc_record('00000000-0000-0000-0000-0000000000c1', array[pg_temp.box('b3')], 'critical', array['pests'], 'Thrips') = 1, 'Critical recorded');
select pg_temp.check(pg_temp.status('b3') = 'back_to_farm:failed:critical:-/-', 'Critical sends the box back to the farm and takes its number away');
select pg_temp.check((select void_reason from boxes where id = pg_temp.box('b3')) = 'Back to farm: Pests or insects', 'the reason says why');
select pg_temp.check(pg_temp.status('b4') = 'active:pending:-:3/3', 'the boxes after it move up');
select pg_temp.check(qc_record('00000000-0000-0000-0000-0000000000c1', array[pg_temp.box('b3')], 'critical', array['pests'], 'Thrips') = 0, 'a result sent twice is recorded once');
select pg_temp.check_refused($$select qc_scan(gen_random_uuid(), pg_temp.id('QS1'), pg_temp.box('b3'))$$, 'was sent BACK TO FARM (Pests or insects)');
select pg_temp.check_refused($$select qc_record(gen_random_uuid(), array[pg_temp.box('b3')], 'pass')$$, 'was already sent back to the farm');
select pg_temp.check_refused($$select * from print_labels(array[pg_temp.box('b3')])$$, 'can''t be printed yet');

create temp table sticker as select back_to_farm_sticker(pg_temp.box('b3')) as r;
select pg_temp.check((select r -> 'reasons' = '["Pests or insects"]'::jsonb and r ->> 'note' = 'Thrips' and r ->> 'qc_by' = 'Wanjiru QC'
  and r -> 'data' ->> 'farmName' = 'Q Farm' and (r ->> 'printed_before')::boolean = false from sticker), 'the sticker has the farm, reasons, note and QC name');
select pg_temp.check((back_to_farm_sticker(pg_temp.box('b3')) ->> 'printed_before')::boolean, 'a second sticker says it was printed before');
select pg_temp.check((select count(*) from back_to_farm_stickers where box_id = pg_temp.box('b3')) = 2, 'each sticker print is logged');
select pg_temp.check_refused($$select back_to_farm_sticker(pg_temp.box('b1'))$$, 'hasn''t been sent back to the farm');

-- ---------------------------------------------------------------- Photos
insert into qc_photos (box_id, storage_path) values (pg_temp.box('b3'), pg_temp.box('b3') || '/thrips.jpg');
insert into storage.objects (bucket_id, name) values ('qc-photos', pg_temp.box('b3') || '/thrips.jpg');
select pg_temp.check_refused($$insert into qc_photos (box_id, storage_path) values (pg_temp.box('b3'), pg_temp.box('b1') || '/x.jpg')$$, 'qc_photos_check');
select pg_temp.check((select photo_count from box_overview where id = pg_temp.box('b3')) = 1, 'the box shows its photo count');

-- ---------------------------------------------------------------- Access
set request.jwt.claim.sub = '30000000-0000-0000-0000-0000000000f1'; -- the farm
select pg_temp.check((select count(*) from qc_photos) = 1, 'the farm sees photos of its own boxes');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'qc-photos') = 1, 'the farm can open those photo files');
select pg_temp.check((select string_agg(status, ',') from boxes where id = pg_temp.box('b3')) = 'back_to_farm', 'the farm sees the box came back');
select pg_temp.check((select count(*) from qc_events) = 0, 'the farm does not see the QC log');
select pg_temp.check_refused($$select qc_record(gen_random_uuid(), array[pg_temp.box('b4')], 'pass')$$, 'Only QC, Admin and Consolidator');
select pg_temp.check_refused($$insert into storage.objects (bucket_id, name) values ('qc-photos', '1/x.jpg')$$, 'row-level security');

set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000d'; -- Finance
select pg_temp.check_refused($$select qc_scan(gen_random_uuid(), pg_temp.id('QS1'), pg_temp.box('b4'))$$, 'Only QC, Admin and Consolidator');
select pg_temp.check((select count(*) from qc_events) > 0, 'Finance can read the QC log');

set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000c'; -- Consolidator
select qc_record(gen_random_uuid(), array[pg_temp.box('b4')], 'pass');
select pg_temp.check(pg_temp.status('b4') = 'active:passed:-:3/3', 'Consolidators can record QC too');
select pg_temp.check_refused($$insert into qc_events (id, box_id, kind, happened_at) values (gen_random_uuid(), pg_temp.box('b4'), 'scan', now())$$, 'permission denied');
select pg_temp.check_refused($$update boxes set qc_status = 'passed'$$, 'permission denied');

reset role;
