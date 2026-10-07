-- Buyer claims, review, credit notes and farm claim notices. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

\ir helpers.sql

insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-00000000000c', 'cl-cons@test'), ('b0000000-0000-0000-0000-0000000000b1', 'cl-buyer@test'),
  ('b0000000-0000-0000-0000-0000000000b2', 'cl-other-buyer@test'),
  ('b0000000-0000-0000-0000-0000000000f1', 'cl-farm-a@test'), ('b0000000-0000-0000-0000-0000000000f2', 'cl-farm-b@test');
insert into user_roles values
  ('b0000000-0000-0000-0000-00000000000c', 'consolidator'), ('b0000000-0000-0000-0000-0000000000b1', 'customer'),
  ('b0000000-0000-0000-0000-0000000000b2', 'customer'),
  ('b0000000-0000-0000-0000-0000000000f1', 'farm'), ('b0000000-0000-0000-0000-0000000000f2', 'farm');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency, payment_terms) values
  ('CFA', 'Claim Farm A', 'Kenya', 'A', 'a@cfa.ke', 'USD', 'Net 15'), ('CFB', 'Claim Farm B', 'Kenya', 'B', 'b@cfb.ke', 'USD', 'Net 15');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, destination_airport, service) values
  ('CLB', 'Claim Buyer', 'Japan', 'C', 'c@clb.jp', 'USD', 'FOB', 'Net 30', 'NRT', 'sourcing'),
  ('CLX', 'Other Buyer', 'Japan', 'X', 'x@clx.jp', 'USD', 'FOB', 'Net 30', 'NRT', 'sourcing');
update profiles set farm_id = (select id from farms where farm_code = 'CFA') where id = 'b0000000-0000-0000-0000-0000000000f1';
update profiles set farm_id = (select id from farms where farm_code = 'CFB') where id = 'b0000000-0000-0000-0000-0000000000f2';
update profiles set customer_id = (select id from customers where customer_code = 'CLB') where id = 'b0000000-0000-0000-0000-0000000000b1';
update profiles set customer_id = (select id from customers where customer_code = 'CLX') where id = 'b0000000-0000-0000-0000-0000000000b2';
insert into box_types (box_code, length_cm, width_cm, height_cm) values ('CLQB', 100, 25, 15);
insert into products (product_code, flower_type, variety, grade, stem_length_cm, stems_per_bunch) values ('CL60', 'Rose', 'Claim Red', 'A1', 60, 20);
insert into pack_rates (product_id, box_type_id, bunches_per_box) select p.id, b.id, 5 from products p, box_types b where p.product_code = 'CL60' and b.box_code = 'CLQB';
insert into price_list (farm_id, product_id, currency, price_per_stem, valid_from)
select f.id, p.id, 'USD', v.price, '2020-01-01' from (values ('CFA', 0.30), ('CFB', 0.28)) v (farm, price)
join farms f on f.farm_code = v.farm cross join products p where p.product_code = 'CL60';
insert into shipments (shipment_ref, flight_date, destination_airport) values ('CLS1', current_date + 20, 'NRT');

create temp table t (name text primary key, id uuid);
grant all on t to authenticated;
create function pg_temp.id(n text) returns uuid language sql stable as $$ select id from t where name = n $$;
insert into t select 'S1', id from shipments where shipment_ref = 'CLS1';

-- A shipped order: 200 stems from farm A and 100 from farm B, boxed (100 stems a box).
set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000c';
insert into t select 'O1', (create_customer_order((select id from customers where customer_code = 'CLB'), pg_temp.id('S1'), null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where product_code = 'CL60'), 'stems', 300))) ->> 'order_id')::uuid;
reset role;
update customer_order_lines set quoted_price_per_stem = 0.40 where order_id = pg_temp.id('O1'); -- as if bought from the catalog
set role authenticated;
select allocate_order_line((select id from customer_order_lines where order_id = pg_temp.id('O1')), (select id from farms where farm_code = 'CFA'), 200);
select allocate_order_line((select id from customer_order_lines where order_id = pg_temp.id('O1')), (select id from farms where farm_code = 'CFB'), 100);
select send_purchase_order(id) from purchase_orders where order_id = pg_temp.id('O1');
select respond_purchase_order(id, true) from purchase_orders where order_id = pg_temp.id('O1');
select assign_boxes(id) from purchase_orders where order_id = pg_temp.id('O1') order by po_number;
reset role;
update shipments set flight_date = current_date - 1, status = 'closed' where id = pg_temp.id('S1'); -- landed this morning
set role authenticated;
create temp table bx as select b.id, f.farm_code from boxes b join farms f on f.id = b.farm_id where b.shipment_id = (select id from t where name = 'S1') order by b.id;
grant select on bx to authenticated;

-- ---------------------------------------------------------------- Buyer reports a claim
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) from claimable_boxes()) = 3, 'the buyer can claim on their 3 boxes while the window is open');
select pg_temp.check((select deadline from claimable_boxes() limit 1) = shipment_arrival(pg_temp.id('S1')) + interval '24 hours', 'the window is 24 hours after arrival');
select pg_temp.check_refused($$select submit_claim(pg_temp.id('S1'), jsonb_build_array(jsonb_build_object('box_id', (select id from bx limit 1), 'reason', 'botrytis', 'stems', 500)))$$, 'claim between 1 and 100');
select pg_temp.check_refused($$select submit_claim(pg_temp.id('S1'), jsonb_build_array(jsonb_build_object('box_id', (select id from bx limit 1), 'reason', 'other', 'stems', 10)))$$, 'Describe the problem');
select pg_temp.check_refused($$select submit_claim(pg_temp.id('S1'), jsonb_build_array(jsonb_build_object('box_id', (select id from bx limit 1), 'reason', 'nope', 'stems', 10)))$$, 'Choose a reason');
insert into t select 'C1', (submit_claim(pg_temp.id('S1'), jsonb_build_array(
    jsonb_build_object('box_id', (select id from bx where farm_code = 'CFA' order by id limit 1), 'reason', 'botrytis', 'stems', 60, 'note', 'Grey mould on the heads'),
    jsonb_build_object('box_id', (select id from bx where farm_code = 'CFA' order by id desc limit 1), 'reason', 'damage', 'stems', 20),
    jsonb_build_object('box_id', (select id from bx where farm_code = 'CFB' limit 1), 'reason', 'too_open', 'stems', 10)),
  '[{"description": "Disposal", "amount": 15}]', 'Three boxes affected') ->> 'claim_id')::uuid;
select pg_temp.check((select claim_number from claims where id = pg_temp.id('C1')) like 'CLM-____-00001', 'claims are numbered CLM-year-00001');
select pg_temp.check((select sum(claimed_amount) from claim_lines where claim_id = pg_temp.id('C1')) = 36, 'claimed at the buyer''s price: 90 stems x 0.40');
select pg_temp.check((select count(*) from claimable_boxes()) = 0, 'claimed boxes are not offered again');
insert into claim_photos (claim_id, claim_line_id, storage_path)
select pg_temp.id('C1'), id, pg_temp.id('C1') || '/line1.jpg' from claim_lines where claim_id = pg_temp.id('C1') and line_no = 1;
select pg_temp.check_refused($$select decide_claim_line((select id from claim_lines where claim_id = pg_temp.id('C1') and line_no = 1), true)$$, 'Only Admin and Consolidator');
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) from claims) = 0 and (select count(*) from claim_photos) = 0, 'another buyer sees nothing');
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select count(*) from claims) = 0 and (select count(*) from claim_lines) = 0, 'farms never see the claim itself (buyer and buyer price)');

-- ---------------------------------------------------------------- Consolidator reviews
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000c';
select pg_temp.check_refused($$select finish_claim_review(pg_temp.id('C1'))$$, 'every box and cost');
select decide_claim_line((select id from claim_lines where claim_id = pg_temp.id('C1') and line_no = 1), true);
select decide_claim_line((select id from claim_lines where claim_id = pg_temp.id('C1') and line_no = 2), true, 10, 'Half the damage was in transit');
select pg_temp.check_refused($$select decide_claim_line((select id from claim_lines where claim_id = pg_temp.id('C1') and line_no = 3), false)$$, 'reason');
select decide_claim_line((select id from claim_lines where claim_id = pg_temp.id('C1') and line_no = 3), false, null, 'Within the agreed opening stage');
select pg_temp.check_refused($$select decide_claim_cost((select id from claim_costs where claim_id = pg_temp.id('C1')), true)$$, 'which farm');
select decide_claim_cost((select id from claim_costs where claim_id = pg_temp.id('C1')), true, null, (select id from farms where farm_code = 'CFA'));
select pg_temp.check((finish_claim_review(pg_temp.id('C1'), 'Thank you for the photos') ->> 'notices')::int = 1, 'one notice: only farm A has approved lines');
select pg_temp.check((select amount || ' ' || currency from credit_notes where claim_id = pg_temp.id('C1')) = '43.00 USD',
  'the buyer''s credit note: 60 x 0.40 + 10 x 0.40 + 15 disposal');
select pg_temp.check((select amount from farm_claim_notices where claim_id = pg_temp.id('C1')) = 36.00,
  'farm A''s notice at its own price: 70 stems x 0.30 + 15 disposal');
select pg_temp.check_refused($$select decide_claim_line((select id from claim_lines where claim_id = pg_temp.id('C1') and line_no = 1), false, null, 'changed my mind')$$, 'already decided');

-- ---------------------------------------------------------------- Buyer sees the outcome
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select string_agg(decision || ':' || coalesce(decision_note, ''), ',' order by line_no) from claim_lines where claim_id = pg_temp.id('C1'))
  = 'approved:,approved:Half the damage was in transit,denied:Within the agreed opening stage', 'the buyer sees each decision and reason');
select pg_temp.check((select count(*) from credit_notes) = 1 and (select count(*) from farm_claim_notices) = 0, 'and their credit note, not the farm notice');

-- ---------------------------------------------------------------- Farms
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000f2';
select pg_temp.check((select count(*) from farm_claim_notices) = 0, 'farm B has nothing: its line was denied');
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select count(*) from farm_claim_notice_lines) = 3 and (select count(*) from claim_photos) = 1, 'farm A sees its notice lines and the photo of its box');
select pg_temp.check((select string_agg(reason, ' | ' order by amount desc) from farm_claim_notice_lines) like 'Botrytis: Grey mould on the heads | Disposal | Physical%', 'with the reasons');
select claim_notice_message((select id from farm_claim_notices), 'Can you share the QC result for this box?');
select pg_temp.check((select status from farm_claim_notices) = 'queried', 'a farm query');
select pg_temp.check_refused($$select farm_send_credit_note((select id from farm_claim_notices), '', 36, current_date)$$, 'credit note number');
select farm_send_credit_note((select id from farm_claim_notices), 'CN-FA-0091', 36, current_date, null, 'Accepted');
select pg_temp.check((select status || ':' || credit_note_number from farm_claim_notices) = 'credited:CN-FA-0091', 'farm A responds with its credit note');
select pg_temp.check_refused($$select farm_send_credit_note((select id from farm_claim_notices), 'CN-2', 1, current_date)$$, 'already sent');
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000f2';
select pg_temp.check_refused($$select farm_send_credit_note((select id from farm_claim_notices where claim_id = pg_temp.id('C1')), 'X', 1, current_date)$$, 'not for your farm');
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000c';
select close_claim_notice((select id from farm_claim_notices where claim_id = pg_temp.id('C1')), 'Received, thank you');
reset role;
select pg_temp.check((select string_agg(distinct audience || ':' || kind, ',') from notifications where attachments ? 'claim_id' or attachments ? 'notice_id')
  = 'customer:claim_decided,farm:claim_notice,staff:claim_submitted,staff:farm_credit_note,staff:farm_query', 'everyone was notified along the way');
set role authenticated;

-- ---------------------------------------------------------------- The window closes
reset role;
update ordering_settings set claim_window_hours = 1;
update shipments set arrived_at = now() - interval '2 hours' where id = pg_temp.id('S1');
set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
select pg_temp.check_refused($$select submit_claim(pg_temp.id('S1'), jsonb_build_array(jsonb_build_object('box_id', (select id from bx where farm_code = 'CFB' limit 1), 'reason', 'too_open', 'stems', 1)))$$, 'claim window');
reset role;
rollback;
