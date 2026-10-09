-- Load planner: airlines (which containers each flies) and a shipment's boxes by size.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

\ir helpers.sql

insert into auth.users (id, email) values ('f1000000-0000-0000-0000-00000000000c', 'lp-cons@test'), ('f1000000-0000-0000-0000-0000000000f1', 'lp-farm@test');
insert into user_roles values ('f1000000-0000-0000-0000-00000000000c', 'consolidator'), ('f1000000-0000-0000-0000-0000000000f1', 'farm');
insert into shipments (shipment_ref, flight_date, destination_airport) values ('LP1', current_date + 3, 'NRT');
set role authenticated;

set request.jwt.claim.sub = 'f1000000-0000-0000-0000-00000000000c';
select pg_temp.check((select string_agg(code, ',' order by code) from airlines) = 'EK,ET,KQ,QR,TK', 'the airlines on ConsolFlora''s routes');
select pg_temp.check((select ulds from airlines where code = 'EK') = '{AKE,PMC-LD,PMC-MD300}' and (select ulds from airlines where code = 'KQ') = '{AKE,PMC-LD}', 'and the containers each flies');
update airlines set ulds = '{AKE}' where code = 'KQ';
select pg_temp.check((select ulds from airlines where code = 'KQ') = '{AKE}', 'staff change an airline''s containers');
select pg_temp.check((select count(*) from shipment_load_lines((select id from shipments where shipment_ref = 'LP1'))) = 0, 'a shipment with no boxes yet has no load lines');

set request.jwt.claim.sub = 'f1000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select count(*) from airlines) = 0, 'farms don''t see the airlines');
reset role;
rollback;
