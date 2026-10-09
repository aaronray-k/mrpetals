-- The master price file import: farms, webshop varieties, products, farm prices and costing figures.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

\ir helpers.sql

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-00000000000c', 'm-cons@test'), ('e0000000-0000-0000-0000-00000000000d', 'm-fin@test'),
  ('e0000000-0000-0000-0000-0000000000f1', 'm-farm@test'), ('e0000000-0000-0000-0000-0000000000b1', 'm-buyer@test');
insert into user_roles values
  ('e0000000-0000-0000-0000-00000000000c', 'consolidator'), ('e0000000-0000-0000-0000-00000000000d', 'finance'),
  ('e0000000-0000-0000-0000-0000000000f1', 'farm'), ('e0000000-0000-0000-0000-0000000000b1', 'customer');
insert into farms (farm_code, farm_name, country, sales_agent_name, sales_agent_email, currency) values ('AFRI', 'Africalla', 'Kenya', 'Ann', 'ann@afri.ke', 'USD');
create temp table ids (k text primary key, v jsonb);
grant all on ids to authenticated;
set role authenticated;

set request.jwt.claim.sub = 'e0000000-0000-0000-0000-00000000000c';
insert into ids select 'farms', master_import_farms('[
  {"name": "africalla ", "grower": null, "email": "sales@afri.example", "location": "Naivasha", "currency": "USD"},
  {"name": "Eco Roses ltd Utee ( BTG)", "grower": "Eco Roses ltd", "email": null, "phone": "+254 7", "location": "Utee", "altitude": "2,100 m", "currency": "USD"}
]');
select pg_temp.check((select count(*) from farms where farm_code in ('AFRI', 'ECOR')) = 2 and (select count(*) from farms where source = 'master') = 1, 'an existing farm is matched by name (any case and spacing); a new one is added');
select pg_temp.check((select sales_agent_email || ':' || location from farms where farm_code = 'AFRI') = 'ann@afri.ke:Naivasha', 'an existing farm keeps its details; only empty ones are filled');
select pg_temp.check((select farm_code || ':' || grower || ':' || source || ':' || sales_agent_email from farms where grower is not null) = 'ECOR:Eco Roses ltd:master:', 'a new farm: a code from its name, its grower, from the master file');

insert into ids select 'vars', master_import_varieties('[
  {"key": "rose|athena", "flower_type": "Rose", "name": "Athena", "grade": "Premium", "colour": "White", "photo": "p03_athena.webp", "spellings": ["ATHENA", "Athena 4+"]},
  {"key": "gyps|xlence", "flower_type": "Gypsophila", "name": "Xlence", "grade": null, "colour": "White", "photo": null, "spellings": ["Xlence"]}
]');
select pg_temp.check((select count(*) from varieties) = 2, 'one webshop variety per flower and name');
select pg_temp.check(master_import_varieties('[{"key": "x", "flower_type": "Rose", "name": "Athena 4+", "spellings": ["Athena 4+"]}]') ->> 'x' = (select v ->> 'rose|athena' from ids where k = 'vars'),
  'a re-import finds a variety again by a spelling seen before');

select pg_temp.check(master_import_offers(jsonb_build_array(
  jsonb_build_object('farm_id', (select v ->> 'africalla ' from ids where k = 'farms'), 'variety_id', (select v ->> 'rose|athena' from ids where k = 'vars'), 'length_cm', 50, 'head_size_cm', 5,
    'currency', 'USD', 'price', 0.22, 'fob_margin', 0.05, 'cif_margin', 0.05, 'stems_per_box', 400, 'box_weight_kg', 16),
  jsonb_build_object('farm_id', (select v ->> 'Eco Roses ltd Utee ( BTG)' from ids where k = 'farms'), 'variety_id', (select v ->> 'rose|athena' from ids where k = 'vars'), 'length_cm', 50,
    'currency', 'USD', 'price', 0.24, 'fob_margin', 0.04, 'cif_margin', 0.05, 'stems_per_box', 400, 'box_weight_kg', 16),
  jsonb_build_object('farm_id', (select v ->> 'africalla ' from ids where k = 'farms'), 'variety_id', (select v ->> 'gyps|xlence' from ids where k = 'vars'), 'length_cm', 80,
    'currency', 'EUR', 'price', 0.45, 'fob_margin', 0.04, 'stems_per_box', 100, 'box_weight_kg', 12, 'trucking_per_stem', 0.02),
  jsonb_build_object('farm_id', (select v ->> 'africalla ' from ids where k = 'farms'), 'variety_id', (select v ->> 'gyps|xlence' from ids where k = 'vars'), 'length_cm', 90, 'currency', 'EUR', 'price', 0)
)) = 3, 'prices saved; a zero price is not an offer');
select pg_temp.check((select string_agg(product_code || ':' || stems_per_bunch, ',' order by product_code) from products where variety_id is not null) = 'GYP-XLENCE-80:10,ROS-ATHENA-50:20',
  'one product per variety and length, shared by the farms that grow it');
select pg_temp.check((select count(*) from price_list pl join products p on p.id = pl.product_id where p.variety_id is not null) = 3 and (select currency from price_list pl join products p on p.id = pl.product_id where p.product_code = 'GYP-XLENCE-80') = 'EUR',
  'farm prices in their own currency, from today');
select pg_temp.check((select string_agg(stems_per_box || ':' || box_weight_kg, ',') from farm_offers fo join products p on p.id = fo.product_id where p.product_code = 'ROS-ATHENA-50') = '400:16.00,400:16.00',
  'each farm''s costing figures');
-- Importing again updates, never duplicates.
select master_import_offers(jsonb_build_array(jsonb_build_object('farm_id', (select v ->> 'africalla ' from ids where k = 'farms'), 'variety_id', (select v ->> 'rose|athena' from ids where k = 'vars'),
  'length_cm', 50, 'currency', 'USD', 'price', 0.25, 'fob_margin', 0.06, 'stems_per_box', 400, 'box_weight_kg', 16)));
select pg_temp.check((select count(*) from price_list pl join products p on p.id = pl.product_id where p.variety_id is not null) = 3 and (select price_per_stem from price_list pl join farms f on f.id = pl.farm_id join products p on p.id = pl.product_id where f.farm_code = 'AFRI' and p.product_code = 'ROS-ATHENA-50') = 0.25,
  'importing again the same day replaces the price');

-- The freight rate: one setting, logged.
select set_costing_settings(4.30, 'USD', false);
select pg_temp.check((select freight_per_kg from costing_settings) = 4.30 and (select count(*) from costing_settings_log) = 1, 'freight per kg set and logged');
select pg_temp.check_refused($$select set_costing_settings(-1, 'USD', false)$$, 'between 0 and 100');

-- Who sees what.
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) from farm_offers) = 3 and (select count(*) from costing_settings) = 1, 'Finance reads margins and the freight rate');
select pg_temp.check_refused($$select set_costing_settings(5, 'USD', false)$$, 'Only Admin and Consolidator');
select pg_temp.check_refused($$select master_import_farms('[]')$$, 'Only Admin and Consolidator');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select count(*) from farm_offers) = 0 and (select count(*) from costing_settings) = 0, 'farms never see ConsolFlora''s margins');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) from varieties) = 2 and (select count(*) from farm_offers) = 0, 'buyers see the webshop varieties, not margins');
reset role;
rollback;
