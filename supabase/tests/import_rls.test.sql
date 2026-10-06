-- Import and RLS tests. Run with `npm run test:db` (see run.sh). Each check raises on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;

-- Raises unless the statement fails with a message containing the expected text.
create function pg_temp.check_refused(stmt text, expected text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAILED: expected refusal containing "%"', expected;
exception when others then
  if sqlerrm like 'FAILED:%' or position(expected in sqlerrm) = 0 then
    raise exception 'FAILED: expected "%", got "%"', expected, sqlerrm;
  end if;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test', '{"full_name":"Ada Admin"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cons@test', '{}'),
  ('00000000-0000-0000-0000-00000000000f', 'farm@test', '{}'),
  ('00000000-0000-0000-0000-00000000000e', 'qc@test', '{}');
insert into user_roles values
  ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000c', 'consolidator'),
  ('00000000-0000-0000-0000-00000000000f', 'farm'), ('00000000-0000-0000-0000-00000000000e', 'qc');
select pg_temp.check((select count(*) from profiles) = 4, 'a profile is created for each new user');
select pg_temp.check((select full_name from profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Ada Admin', 'profile takes the name from sign-up');

-- ---------------------------------------------------------------- Consolidator imports
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';

select pg_temp.check(import_sheet('Farms', 'f.xlsx', '[
  {"farm_code":"KIBO","farm_name":"Kibo","country":"Kenya","sales_agent_name":"Ann","sales_agent_email":"a@k.ke","currency":"USD","payment_terms":"Net 15","active":true},
  {"farm_code":"NAKU","farm_name":"Naku","country":"Kenya","sales_agent_name":"Ben","sales_agent_email":"b@k.ke","currency":"USD","payment_terms":"Net 7","active":true}]')
  = '{"total": 2, "updated": 0, "inserted": 2}', 'new codes insert');
select pg_temp.check(import_sheet('Farms', 'f2.xlsx', '[
  {"farm_code":"KIBO","farm_name":"Kibo Roses","country":"Kenya","sales_agent_name":"Ann","sales_agent_email":"a@k.ke","currency":"USD","payment_terms":"Net 15","active":false},
  {"farm_code":"OLDO","farm_name":"Oldo","country":"Kenya","sales_agent_name":"Cy","sales_agent_email":"c@k.ke","currency":"KES","payment_terms":"Prepaid","active":true}]')
  = '{"total": 2, "updated": 1, "inserted": 1}', 'existing codes update, new codes insert');
select pg_temp.check((select farm_name = 'Kibo Roses' and not active and updated_by = auth.uid() from farms where farm_code = 'KIBO'), 'update applied, active = N hides, updated_by recorded');
select pg_temp.check((select count(*) from farms) = 3, 'nothing deleted by import');

select import_sheet('Customers', 'c.xlsx', '[{"customer_code":"FLOR","company_name":"Flor BV","country":"Netherlands","contact_name":"Piet","contact_email":"p@f.nl","currency":"EUR","incoterm":"CPT","payment_terms":"Net 15","credit_limit":20000,"destination_airport":"AMS","language":"NL","active":true}]');
select import_sheet('BoxTypes', 'b.xlsx', '[{"box_code":"QB","length_cm":100,"width_cm":25,"height_cm":15,"tare_weight_kg":1.2,"active":true}]');
select pg_temp.check((select volumetric_kg from box_types where box_code = 'QB') = 6.25, 'volumetric weight is L x W x H / 6000');
select import_sheet('Products', 'p.xlsx', '[{"product_code":"ROS-1","flower_type":"Rose","variety":"Red","grade":"A1","stem_length_cm":70,"stems_per_bunch":10,"default_farm_code":"KIBO","active":true}]');
select pg_temp.check((select f.farm_code from products p join farms f on f.id = p.default_farm_id) = 'KIBO', 'default_farm_code resolves to the farm');
select import_sheet('PackRates', 'r.xlsx', '[{"product_code":"ROS-1","box_code":"QB","bunches_per_box":8}]');
select import_sheet('PriceList', 'pl.xlsx', '[{"farm_code":"KIBO","product_code":"ROS-1","currency":"USD","price_per_stem":0.25,"valid_from":"2026-10-01"}]');
select import_sheet('FreightRates', 'fr.xlsx', '[{"origin_airport":"NBO","destination_airport":"AMS","currency":"USD","rate_per_kg":3.1,"valid_from":"2026-10-01"}]');
select pg_temp.check(import_sheet('FreightRates', 'fr.xlsx', '[{"origin_airport":"NBO","destination_airport":"AMS","currency":"USD","rate_per_kg":3.3,"valid_from":"2026-10-01"}]')
  = '{"total": 1, "updated": 1, "inserted": 0}', 'freight rate without airline updates on the same key');
select pg_temp.check(import_sheet('Lists', 'l.xlsx', '[{"list_name":"Country","value":"Japan","sort_order":7},{"list_name":"Country","value":"Ecuador","sort_order":11}]')
  = '{"total": 2, "updated": 1, "inserted": 1}', 'list values upsert');

select import_sheet('PackingList', 'pk.xlsx', '[
  {"shipment_ref":"S1","line_no":1,"awb":"706-12345675","customer_code":"FLOR","farm_code":"KIBO","product_code":"ROS-1","box_code":"QB","boxes":12},
  {"shipment_ref":"S1","line_no":2,"customer_code":"FLOR","farm_code":"NAKU","product_code":"ROS-1","box_code":"QB","boxes":5},
  {"shipment_ref":"S2","line_no":1,"customer_code":"FLOR","farm_code":"NAKU","product_code":"ROS-1","box_code":"QB","boxes":3}]');
select pg_temp.check((select string_agg(format('%s#%s:%s-%s/%s', s.shipment_ref, l.line_no, l.box_from, l.box_to, l.total_stems), ' ' order by s.shipment_ref, l.line_no)
  from packing_list_lines l join shipments s on s.id = l.shipment_id) = 'S1#1:1-12/960 S1#2:13-17/400 S2#1:1-3/240', 'boxes numbered 1..N per shipment, stems calculated');
select pg_temp.check((select mawb from shipments where shipment_ref = 'S1') = '706-12345675', 'awb stored as the shipment MAWB');

select pg_temp.check_refused($$select import_sheet('PackingList', 'x', '[{"shipment_ref":"S1","line_no":1,"customer_code":"FLOR","farm_code":"KIBO","product_code":"ROS-1","box_code":"QB","boxes":1}]')$$, 'Imports can''t remove lines');
select pg_temp.check_refused($$select import_sheet('PackRates', 'x', '[{"product_code":"NOPE","box_code":"QB","bunches_per_box":1}]')$$, 'product_code NOPE is not in the database');
select pg_temp.check_refused($$select import_sheet('Nope', 'x', '[{}]')$$, 'Unknown sheet');
select pg_temp.check_refused($$select import_sheet('Farms', 'x', '[]')$$, 'no rows');
reset role;
update shipments set status = 'closed' where shipment_ref = 'S2';
set role authenticated;
select pg_temp.check_refused($$select import_sheet('PackingList', 'x', '[{"shipment_ref":"S2","line_no":1,"customer_code":"FLOR","farm_code":"NAKU","product_code":"ROS-1","box_code":"QB","boxes":9}]')$$, 'is closed');
select pg_temp.check((select boxes from packing_list_lines l join shipments s on s.id = l.shipment_id where s.shipment_ref = 'S2') = 3, 'closed shipment unchanged');

with d as (delete from farms where farm_code = 'NAKU' returning 1) select pg_temp.check((select count(*) from d) = 0, 'farms cannot be deleted (no delete policy)');
with u as (update import_runs set status = 'failed' returning 1) select pg_temp.check((select count(*) from u) = 0, 'import log cannot be edited');
select pg_temp.check((select count(*) from import_runs where user_id = auth.uid() and status = 'succeeded') = 11, 'every successful import is logged for the user');
select pg_temp.check_refused($$insert into import_runs (user_id, file_name, sheet, status) values ('00000000-0000-0000-0000-00000000000a', 'x', 'Farms', 'failed')$$, 'row-level security');

-- ---------------------------------------------------------------- QC: reads, cannot import
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.check((select count(*) from farms) = 3, 'QC reads farms');
select pg_temp.check((select count(*) from packing_list_lines) = 3, 'QC reads packing lists');
select pg_temp.check((select count(*) from import_runs) = 0, 'QC cannot read the import log');
select pg_temp.check((select count(*) from freight_rates) = 0, 'QC cannot read freight rates');
select pg_temp.check_refused($$select import_sheet('Farms', 'x', '[{"farm_code":"Z"}]')$$, 'Only Admin and Consolidator');

-- ---------------------------------------------------------------- Farm user: own farm only
reset role;
update profiles set farm_id = (select id from farms where farm_code = 'NAKU') where id = '00000000-0000-0000-0000-00000000000f';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.check((select string_agg(farm_code, ',') from farms) = 'NAKU', 'farm user sees only their farm');
select pg_temp.check((select count(*) from packing_list_lines) = 2, 'farm user sees only their packing lines');
select pg_temp.check((select count(*) from shipments) = 2, 'farm user sees shipments they are on');
select pg_temp.check((select count(*) from price_list) = 0, 'farm user cannot see other farms'' prices');
select pg_temp.check((select count(*) from customers) = 0, 'farm user cannot see customers');
select pg_temp.check((select count(*) from products) = 1, 'farm user reads products');
select pg_temp.check_refused($$update profiles set farm_id = null where id = auth.uid()$$, 'permission denied');
update profiles set show_tips = false where id = auth.uid();
select pg_temp.check((select not show_tips from profiles where id = auth.uid()), 'user can switch tips off');
select pg_temp.check((select count(*) from profiles) = 1, 'farm user reads only their own profile');

-- ---------------------------------------------------------------- Signed out
reset role;
set role anon;
set request.jwt.claim.sub = '';
select pg_temp.check((select count(*) from farms) = 0, 'anonymous users see nothing');
select pg_temp.check_refused($$select import_sheet('Farms', 'x', '[{}]')$$, 'permission denied');

reset role;
\echo 'All database tests passed.'
