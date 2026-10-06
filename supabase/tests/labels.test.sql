-- Label template and print-log tests. Run with `npm run test:db` (see run.sh).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir helpers.sql

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-00000000000a', 'label-admin@test'),
  ('10000000-0000-0000-0000-00000000000c', 'label-cons@test'),
  ('10000000-0000-0000-0000-00000000000e', 'label-qc@test'),
  ('10000000-0000-0000-0000-00000000000d', 'label-finance@test');
insert into user_roles values
  ('10000000-0000-0000-0000-00000000000a', 'admin'), ('10000000-0000-0000-0000-00000000000c', 'consolidator'),
  ('10000000-0000-0000-0000-00000000000e', 'qc'), ('10000000-0000-0000-0000-00000000000d', 'finance');
insert into customers (customer_code, company_name, country, contact_name, contact_email, currency, incoterm, payment_terms, destination_airport)
values ('LBL1', 'Label Buyer BV', 'Netherlands', 'P', 'p@l.nl', 'EUR', 'CPT', 'Net 15', 'AMS'),
       ('LBL2', 'Second Buyer BV', 'Netherlands', 'Q', 'q@l.nl', 'EUR', 'CPT', 'Net 15', 'AMS');

-- A minimal valid layout, and one without the QR code.
create temp table t_layouts as select
  '{"version":1,"elements":[{"type":"qr","id":"qr"},{"type":"box_id","id":"box_id"},{"type":"box_count","id":"box_count"}]}'::jsonb as ok,
  '{"version":1,"elements":[{"type":"box_id","id":"box_id"},{"type":"box_count","id":"box_count"}]}'::jsonb as no_qr;
grant select on t_layouts to authenticated;

-- ---------------------------------------------------------------- Admin designs templates
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';

create temp table t_ids (name text primary key, id uuid);
insert into t_ids select 'default', (save_label_template(null, 'Standard', null, true, 150, 70, 'rotated', (select ok from t_layouts)) ->> 'template_id')::uuid;
select pg_temp.check((select current_version from label_templates where id = (select id from t_ids where name = 'default')) = 1, 'first save creates version 1');

select pg_temp.check(save_label_template((select id from t_ids where name = 'default'), 'Standard v2', null, true, 100, 150, 'normal', (select ok from t_layouts), 1) ->> 'version' = '2', 'saving again creates version 2');
select pg_temp.check((select string_agg(format('%s:%s', version, width_mm), ',' order by version) from label_template_versions where template_id = (select id from t_ids where name = 'default')) = '1:150.0,2:100.0', 'version 1 is kept as it was');
select pg_temp.check((select name from label_templates where id = (select id from t_ids where name = 'default')) = 'Standard v2', 'template name updated');

with u as (update label_template_versions set width_mm = 120 returning 1) select pg_temp.check((select count(*) from u) = 0, 'saved versions cannot be changed');
with d as (delete from label_template_versions returning 1) select pg_temp.check((select count(*) from d) = 0, 'saved versions cannot be deleted');
with d as (delete from label_templates returning 1) select pg_temp.check((select count(*) from d) = 0, 'templates cannot be deleted');

select pg_temp.check_refused($$select save_label_template((select id from t_ids where name = 'default'), 'X', null, true, 100, 150, 'normal', (select ok from t_layouts), 1)$$, 'Someone saved version 2');
select pg_temp.check_refused($$select save_label_template(null, 'No QR', null, false, 100, 100, 'normal', (select no_qr from t_layouts))$$, 'label_template_versions_layout_check');
select pg_temp.check_refused($$select save_label_template(null, 'Second default', null, true, 100, 100, 'normal', (select ok from t_layouts))$$, 'already a default label template');
select pg_temp.check_refused($$select save_label_template(null, 'Too small', null, false, 10, 100, 'normal', (select ok from t_layouts))$$, 'width_mm_check');
select pg_temp.check_refused($$select save_label_template(null, 'Odd feed', null, false, 100, 100, 'upside-down', (select ok from t_layouts))$$, 'orientation_check');

insert into t_ids select 'buyer', (save_label_template(null, 'Label Buyer', (select id from customers where customer_code = 'LBL1'), false, 100, 100, 'normal', (select ok from t_layouts)) ->> 'template_id')::uuid;
select pg_temp.check_refused($$select save_label_template(null, 'Again', (select id from customers where customer_code = 'LBL1'), false, 100, 100, 'normal', (select ok from t_layouts))$$, 'This buyer already has a label template');
select pg_temp.check_refused($$select save_label_template(null, 'Both', (select id from customers where customer_code = 'LBL2'), true, 100, 100, 'normal', (select ok from t_layouts))$$, 'label_templates_check');

-- Which version prints for a buyer: their own, otherwise the default.
select pg_temp.check(label_template_version_for((select id from customers where customer_code = 'LBL1'))
  = (select v.id from label_template_versions v where v.template_id = (select id from t_ids where name = 'buyer') and v.version = 1), 'a buyer with a template gets it');
select pg_temp.check(label_template_version_for((select id from customers where customer_code = 'LBL2'))
  = (select v.id from label_template_versions v where v.template_id = (select id from t_ids where name = 'default') and v.version = 2), 'other buyers get the latest default version');

select pg_temp.check((select string_agg(format('%s:v%s:%s', name, current_version, width_mm), ',' order by name) from label_templates_current) = 'Label Buyer:v1:100.0,Standard v2:v2:100.0', 'current view shows each template with its latest version');

-- ---------------------------------------------------------------- Consolidator: reads, prints, can't design
set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) from label_templates) = 2, 'consolidator reads templates');
select pg_temp.check((select count(*) from label_template_versions) = 3, 'consolidator reads versions');
select pg_temp.check_refused($$select save_label_template(null, 'Mine', null, false, 100, 100, 'normal', (select ok from t_layouts))$$, 'Only Admin users');
select pg_temp.check_refused($$insert into label_templates (name) values ('sneaky')$$, 'row-level security');

create temp table t_version as select id from label_template_versions limit 1;
grant select on t_version to authenticated;
insert into label_prints (box_id, template_version_id, kind) select 42, id, 'print' from t_version;
insert into label_prints (box_id, template_version_id, kind, reason) select 42, id, 'reprint', 'Label torn at packing' from t_version;
select pg_temp.check((select count(*) from label_prints where box_id = 42 and printed_by = auth.uid()) = 2, 'prints are logged for the user');
select pg_temp.check_refused($$insert into label_prints (box_id, template_version_id, kind) select 42, id, 'reprint' from t_version$$, 'label_prints_check');
select pg_temp.check_refused($$insert into label_prints (box_id, template_version_id, kind, reason, printed_by) select 42, id, 'reprint', 'Torn label', '10000000-0000-0000-0000-00000000000a' from t_version$$, 'row-level security');
with u as (update label_prints set reason = 'changed' returning 1) select pg_temp.check((select count(*) from u) = 0, 'the print log cannot be edited');
with d as (delete from label_prints returning 1) select pg_temp.check((select count(*) from d) = 0, 'the print log cannot be deleted');

-- ---------------------------------------------------------------- QC prints too; Finance has no access
set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000e';
insert into label_prints (box_id, template_version_id, kind, reason) select 43, id, 'reprint', 'Wet box' from t_version;
select pg_temp.check((select count(*) from label_prints) = 3, 'QC logs and reads prints');

set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) from label_templates) = 0, 'Finance cannot read templates');
select pg_temp.check((select count(*) from label_templates_current) = 0, 'Finance cannot read templates through the view');
select pg_temp.check((select count(*) from label_prints) = 0, 'Finance cannot read the print log');
select pg_temp.check_refused($$insert into label_prints (box_id, template_version_id, kind) select 44, id, 'print' from t_version$$, 'row-level security');

reset role;
