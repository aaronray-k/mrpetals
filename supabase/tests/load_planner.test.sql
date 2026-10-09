-- Load planner: airlines (which containers each flies) and a shipment's boxes by size.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

\ir helpers.sql

insert into auth.users (id, email) values ('f1000000-0000-0000-0000-00000000000c', 'lp-cons@test'), ('f1000000-0000-0000-0000-0000000000f1', 'lp-farm@test');
insert into auth.users (id, email) values ('f1000000-0000-0000-0000-00000000000d', 'lp-fin@test');
insert into user_roles values ('f1000000-0000-0000-0000-00000000000c', 'consolidator'), ('f1000000-0000-0000-0000-0000000000f1', 'farm'), ('f1000000-0000-0000-0000-00000000000d', 'finance');
insert into box_types (box_code, length_cm, width_cm, height_cm) values ('LPHB', 100, 50, 30);
insert into shipments (shipment_ref, flight_date, destination_airport) values ('LP1', current_date + 3, 'NRT');
set role authenticated;

set request.jwt.claim.sub = 'f1000000-0000-0000-0000-00000000000c';
select pg_temp.check((select string_agg(code, ',' order by code) from airlines) = 'EK,ET,KQ,QR,TK', 'the airlines on ConsolFlora''s routes');
select pg_temp.check((select ulds from airlines where code = 'EK') = '{AKE,PMC-LD,PMC-MD300}' and (select ulds from airlines where code = 'KQ') = '{AKE,PMC-LD}', 'and the containers each flies');
update airlines set ulds = '{AKE}' where code = 'KQ';
select pg_temp.check((select ulds from airlines where code = 'KQ') = '{AKE}', 'staff change an airline''s containers');
select pg_temp.check((select count(*) from shipment_load_lines((select id from shipments where shipment_ref = 'LP1'))) = 0, 'a shipment with no boxes yet has no load lines');

select pg_temp.check((select size_basis || ':' || wall_mm || ':' || bulge_top_mm || ':' || bulge_side_mm || ':' || bulge_end_mm from box_types where box_code = 'LPHB') = 'outside:5.0:10.0:5.0:0.0',
  'box types start as outside sizes, 5 mm walls, 10/5/0 mm bulge');
update box_types set bulge_top_mm = 14 where box_code = 'LPHB';
select pg_temp.check((select bulge_top_mm from box_types where box_code = 'LPHB') = 14, 'staff tune a box type''s bulge');
select pg_temp.check_refused($$update box_types set bulge_top_mm = 150 where box_code = 'LPHB'$$, 'box_types_bulge_top_mm_check');
insert into load_checks (airline, uld_code, planned_boxes, actual_boxes, plan) values ('QR', 'AKE', 24, 22, '{"uldCode": "AKE", "lines": []}');
select pg_temp.check((select created_by from load_checks) = 'f1000000-0000-0000-0000-00000000000c', 'a load check records who entered it');
select pg_temp.check_refused($$insert into load_checks (uld_code, planned_boxes, actual_boxes, plan, created_by) values ('AKE', 1, 1, '{}', 'f1000000-0000-0000-0000-00000000000d')$$, 'row-level security');

set request.jwt.claim.sub = 'f1000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) from load_checks) = 1, 'Finance reads load checks');
select pg_temp.check_refused($$insert into load_checks (uld_code, planned_boxes, actual_boxes, plan) values ('AKE', 1, 1, '{}')$$, 'row-level security');

set request.jwt.claim.sub = 'f1000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select count(*) from airlines) = 0 and (select count(*) from load_checks) = 0, 'farms don''t see the airlines or load checks');
reset role;
rollback;
