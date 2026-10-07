-- Floricode master data, product codes, review flags and label data. Run with `npm run test:db`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir helpers.sql

insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-00000000000a', 'f-admin@test'), ('70000000-0000-0000-0000-00000000000c', 'f-cons@test'),
  ('70000000-0000-0000-0000-0000000000f1', 'f-farm@test'), ('70000000-0000-0000-0000-0000000000b1', 'f-buyer@test');
insert into user_roles values
  ('70000000-0000-0000-0000-00000000000a', 'admin'), ('70000000-0000-0000-0000-00000000000c', 'consolidator'),
  ('70000000-0000-0000-0000-0000000000f1', 'farm'), ('70000000-0000-0000-0000-0000000000b1', 'customer');
insert into products (product_code, flower_type, variety, grade, stem_length_cm, stems_per_bunch) values
  ('FC-NONE', 'Rose', 'No Code', 'A1', 50, 20);
insert into box_types (box_code, length_cm, width_cm, height_cm) values ('FQB', 100, 25, 15);

create temp table base as select $${
  "feature_types": [{"code": "S20", "name": "Stem length", "product_field": "stem_length_cm"},
                    {"code": "Q01", "name": "Quality group", "product_field": "grade"},
                    {"code": "S98", "name": "Ripeness stage", "product_field": "maturity"}],
  "feature_values": [{"feature_type": "S20", "code": "060", "name": "60 cm", "numeric_value": 60},
                     {"feature_type": "S20", "code": "070", "name": "70 cm", "numeric_value": 70},
                     {"feature_type": "Q01", "code": "A1", "name": "A1"},
                     {"feature_type": "S98", "code": "2", "name": "Stage 2", "numeric_value": 2}],
  "products": [{"code": "90001", "name": "R GR TEST RED", "latin_name": "Rosa 'Test Red'", "product_group": "Rosa grootbloemig"},
               {"code": "90002", "name": "R GR TEST PINK", "product_group": "Rosa grootbloemig"},
               {"code": "90003", "name": "R GR OLD", "status": "blocked"}],
  "packaging": [{"code": "901", "name": "Quarter box", "length_cm": 100, "width_cm": 25, "height_cm": 15}],
  "companies": [{"code": "KE9", "gln": "6160001009998", "name": "Test Grower", "country": "Kenya", "kind": "grower"}]
}$$::jsonb as d;
grant select on base to authenticated;

set role authenticated;
-- ---------------------------------------------------------------- Sync
set request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000c';
select pg_temp.check_refused($$select floricode_apply_sync('demo', 'x', '{}')$$, 'Only Admin');
select pg_temp.check_refused($$insert into floricode_products (code, name) values ('1', 'x')$$, 'row-level security');
set request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
select pg_temp.check((floricode_apply_sync('demo', 'demo-initial', (select d from base)) ->> 'changes')::int = 0, 'the first sync loads the list without reporting changes');
select pg_temp.check((select count(*) from floricode_products) = 3 and (select count(*) from floricode_feature_values) = 4, 'reference tables filled');
select pg_temp.check((select detail from product_reviews r join products p on p.id = r.product_id where p.product_code = 'FC-NONE' and r.resolved_at is null) = 'Needs a VBN code.',
  'a product with no VBN code is flagged');
select floricode_log_failure('api', 'no connection');
select pg_temp.check((select status from floricode_sync_runs order by id desc limit 1) = 'failed', 'a failed sync is logged');

-- ---------------------------------------------------------------- Products
set request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000c';
select pg_temp.check_refused($$select save_product(null, '{"product_code": "FC-X", "flower_type": "Rose", "variety": "X", "vbn_code": "12345", "stems_per_bunch": 20, "floricode_features": {"S20": "060", "Q01": "A1"}}')$$,
  'not in the Floricode list');
select pg_temp.check_refused($$select save_product(null, '{"product_code": "FC-X", "flower_type": "Rose", "variety": "X", "vbn_code": "90003", "stems_per_bunch": 20, "floricode_features": {"S20": "060", "Q01": "A1"}}')$$,
  'blocked VBN code');
select pg_temp.check_refused($$select save_product(null, '{"product_code": "FC-X", "flower_type": "Rose", "variety": "X", "vbn_code": "90001", "stems_per_bunch": 20, "floricode_features": {"S20": "065", "Q01": "A1"}}')$$,
  'is not in the Floricode list');
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
insert into ids values ('red', save_product(null, '{"product_code": "fc-red-70", "flower_type": "Rose", "variety": "Test Red", "vbn_code": "90001", "stems_per_bunch": 20,
  "floricode_features": {"S20": "070", "Q01": "A1", "S98": "2"}}'));
select pg_temp.check((select product_code || ':' || stem_length_cm || ':' || grade || ':' || maturity from products where id = (select id from ids where name = 'red'))
  = 'FC-RED-70:70:A1:Stage 2', 'length, grade and maturity come from the Floricode features');
insert into ids values ('pink', save_product(null, '{"product_code": "FC-PINK-60", "flower_type": "Rose", "variety": "Test Pink", "vbn_code": "90002", "stems_per_bunch": 20,
  "floricode_features": {"S20": "060", "Q01": "A1"}}'));
select pg_temp.check_refused($$select save_product(null, '{"product_code": "FC-PINK-60", "flower_type": "Rose", "variety": "Again", "stems_per_bunch": 20, "floricode_features": {"S20": "060", "Q01": "A1"}}')$$,
  'already used');
select pg_temp.check_refused($$select set_box_packaging_code((select id from box_types where box_code = 'FQB'), '999')$$, 'not an active Floricode code');
select set_box_packaging_code((select id from box_types where box_code = 'FQB'), '901');
-- Fixing the product with no code closes its flag.
select save_product(id, jsonb_build_object('product_code', 'FC-NONE', 'flower_type', 'Rose', 'variety', 'No Code', 'vbn_code', '90002', 'stems_per_bunch', 20,
  'floricode_features', '{"S20": "060", "Q01": "A1"}'::jsonb)) from products where product_code = 'FC-NONE';
select pg_temp.check((select resolution from product_reviews r join products p on p.id = r.product_id where p.product_code = 'FC-NONE' and r.reason = 'missing_code') = 'fixed',
  'giving it a code closes the flag');

-- ---------------------------------------------------------------- Changes from Floricode
set request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
select pg_temp.check((floricode_apply_sync('demo', 'demo-update', '{
  "products": [{"code": "90001", "name": "R GR TEST RED", "product_group": "Rosa grootbloemig", "status": "blocked", "replaced_by": "90004"},
               {"code": "90004", "name": "R GR TEST RED!", "product_group": "Rosa grootbloemig"},
               {"code": "90002", "name": "R GR TEST ROSE PINK", "product_group": "Rosa grootbloemig"}],
  "feature_values": [{"feature_type": "S20", "code": "060", "name": "60 cm", "numeric_value": 60, "status": "blocked"}]}') ->> 'changes')::int = 4,
  'blocked code, renamed code, new code and blocked feature value reported');
select pg_temp.check((select detail from product_reviews where product_id = (select id from ids where name = 'red') and reason = 'blocked' and resolved_at is null)
  = 'Floricode blocked VBN code 90001 (R GR TEST RED). Use 90004 (R GR TEST RED!) instead.', 'the blocked code is flagged with its replacement');
select pg_temp.check((select detail from product_reviews where product_id = (select id from ids where name = 'pink') and reason = 'changed' and resolved_at is null)
  like 'VBN 90002 renamed from "R GR TEST PINK" to "R GR TEST ROSE PINK"%', 'a renamed code is flagged on the products using it');
select pg_temp.check((select count(*) from product_reviews where reason = 'feature_blocked' and resolved_at is null) = 2, 'both 60 cm products are flagged for the blocked length');
select pg_temp.check((select count(*) from jsonb_array_elements(dashboard_staff() -> 'actions' -> 'products_to_review') e where e ->> 'product_code' like 'FC-%') = 3,
  'the staff dashboard lists the products to review');
-- Saving a product keeps a blocked value it already had, but can't pick one newly.
set request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000c';
select pg_temp.check_refused($$select save_product((select id from ids where name = 'red'), '{"product_code": "FC-RED-70", "flower_type": "Rose", "variety": "Test Red", "vbn_code": "90001", "stems_per_bunch": 20, "floricode_features": {"S20": "060", "Q01": "A1"}}')$$,
  'Floricode blocked Stem length');
select save_product((select id from ids where name = 'red'), '{"product_code": "FC-RED-70", "flower_type": "Rose", "variety": "Test Red", "vbn_code": "90004", "stems_per_bunch": 20,
  "floricode_features": {"S20": "070", "Q01": "A1", "S98": "2"}}');
select pg_temp.check((select resolution from product_reviews where product_id = (select id from ids where name = 'red') and reason = 'blocked') = 'fixed',
  'moving to the replacement code closes the blocked flag');
select resolve_product_review(id) from product_reviews where product_id = (select id from ids where name = 'pink') and reason = 'changed';
select pg_temp.check((select resolution from product_reviews where product_id = (select id from ids where name = 'pink') and reason = 'changed') = 'checked',
  'staff mark a changed code as checked');

-- ---------------------------------------------------------------- Who sees what
set request.jwt.claim.sub = '70000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) from floricode_products) = 4, 'codes are readable by everyone signed in');
select pg_temp.check((select count(*) from floricode_companies) = 0 and (select count(*) from product_reviews) = 0 and (select count(*) from floricode_sync_runs) = 0,
  'companies, review flags and sync runs are staff only');
select pg_temp.check_refused($$select save_product(null, '{}')$$, 'Only Admin and Consolidator');
select pg_temp.check_refused($$select floricode_apply_sync('demo', 'x', '{}')$$, 'Only Admin');
reset role;
