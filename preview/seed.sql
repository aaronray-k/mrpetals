-- Demo data for the preview site only. Never run against a real ConsolFlora database.
-- Runs once, as the database owner, after the migrations. Demo password for every account:
-- see DEMO_PASSWORD in preview/start.mjs (passed in as :'demo_password').

insert into auth.users (id, email, encrypted_password) values
  ('d0000000-0000-0000-0000-00000000000a', 'admin@demo.consolflora.com', extensions.crypt(:'demo_password', extensions.gen_salt('bf'))),
  ('d0000000-0000-0000-0000-00000000000c', 'consolidator@demo.consolflora.com', extensions.crypt(:'demo_password', extensions.gen_salt('bf'))),
  ('d0000000-0000-0000-0000-00000000000d', 'finance@demo.consolflora.com', extensions.crypt(:'demo_password', extensions.gen_salt('bf'))),
  ('d0000000-0000-0000-0000-00000000000e', 'qc@demo.consolflora.com', extensions.crypt(:'demo_password', extensions.gen_salt('bf'))),
  ('d0000000-0000-0000-0000-0000000000e5', 'senior.qc@demo.consolflora.com', extensions.crypt(:'demo_password', extensions.gen_salt('bf'))),
  ('d0000000-0000-0000-0000-0000000000f1', 'farm@demo.consolflora.com', extensions.crypt(:'demo_password', extensions.gen_salt('bf'))),
  ('d0000000-0000-0000-0000-0000000000b1', 'buyer@demo.consolflora.com', extensions.crypt(:'demo_password', extensions.gen_salt('bf')));
insert into public.user_roles (user_id, role) values
  ('d0000000-0000-0000-0000-00000000000a', 'admin'),
  ('d0000000-0000-0000-0000-00000000000c', 'consolidator'),
  ('d0000000-0000-0000-0000-00000000000d', 'finance'),
  ('d0000000-0000-0000-0000-00000000000e', 'qc'),
  ('d0000000-0000-0000-0000-0000000000e5', 'qc'),
  ('d0000000-0000-0000-0000-0000000000e5', 'senior_qc'),
  ('d0000000-0000-0000-0000-0000000000f1', 'farm'),
  ('d0000000-0000-0000-0000-0000000000b1', 'customer');
update public.profiles p set full_name = v.name
from (values
  ('d0000000-0000-0000-0000-00000000000a'::uuid, 'Amina (Admin)'),
  ('d0000000-0000-0000-0000-00000000000c'::uuid, 'Collins (Consolidator)'),
  ('d0000000-0000-0000-0000-00000000000d'::uuid, 'Faith (Finance)'),
  ('d0000000-0000-0000-0000-00000000000e'::uuid, 'Wanjiru (QC)'),
  ('d0000000-0000-0000-0000-0000000000e5'::uuid, 'Peter (Senior QC)'),
  ('d0000000-0000-0000-0000-0000000000f1'::uuid, 'Grace (Kibo Roses)'),
  ('d0000000-0000-0000-0000-0000000000b1'::uuid, 'Aiko (Pacific Floral)')
) as v (id, name)
where p.id = v.id;

insert into public.farms (farm_code, farm_name, country, region, sales_agent_name, sales_agent_email, currency, payment_terms) values
  ('KIBO', 'Kibo Roses Ltd', 'Kenya', 'Naivasha', 'Grace Wanjiku', 'sales@kibo.example', 'USD', 'Net 15'),
  ('NAKU', 'Naku Flowers', 'Kenya', 'Nakuru', 'John Otieno', 'sales@naku.example', 'USD', 'Net 15'),
  ('OLER', 'Oleria Growers', 'Kenya', 'Timau', 'Mary Njeri', 'sales@oleria.example', 'USD', 'Net 30');
update public.profiles set farm_id = (select id from public.farms where farm_code = 'KIBO') where id = 'd0000000-0000-0000-0000-0000000000f1';

insert into public.customers (customer_code, company_name, country, city, delivery_address, contact_name, contact_email, currency, incoterm, payment_terms, credit_limit, destination_airport) values
  ('PFJ', 'Pacific Floral Japan GK', 'Japan', 'Tokyo 2030031', '4-8-39 Minamimachi', 'Aiko Tanaka', 'orders@pfj.example', 'USD', 'FOB', 'Prepaid', null, 'NRT'),
  ('BLM', 'Bloem Handel BV', 'Netherlands', 'Aalsmeer', 'Legmeerdijk 313', 'Jan de Vries', 'inkoop@bloem.example', 'EUR', 'CPT', 'Net 30', 5000, 'AMS');
update public.profiles set customer_id = (select id from public.customers where customer_code = 'PFJ') where id = 'd0000000-0000-0000-0000-0000000000b1';

insert into public.box_types (box_code, description, length_cm, width_cm, height_cm) values
  ('QB', 'Quarter box', 100, 25, 15), ('HB', 'Half box', 100, 50, 15);
insert into public.products (product_code, flower_type, variety, colour, grade, stem_length_cm, stems_per_bunch, default_farm_id) values
  ('ROS-ER-70', 'Rose', 'Ever Red', 'Red', 'A1', 70, 20, (select id from public.farms where farm_code = 'KIBO')),
  ('ROS-MR-40', 'Rose', 'Madam Red', 'Red', 'A1', 40, 25, (select id from public.farms where farm_code = 'NAKU')),
  ('ROS-KD-60', 'Rose', 'Kings Day', 'Yellow', 'A1', 60, 20, null),
  ('ROS-RV-50', 'Rose', 'Revival', 'Pink', 'A1', 50, 20, (select id from public.farms where farm_code = 'OLER'));
insert into public.pack_rates (product_id, box_type_id, bunches_per_box)
select p.id, b.id, v.bunches
from (values ('ROS-ER-70', 'QB', 8), ('ROS-MR-40', 'QB', 20), ('ROS-KD-60', 'QB', 8), ('ROS-KD-60', 'HB', 16), ('ROS-RV-50', 'QB', 10)) as v (prod, box, bunches)
join public.products p on p.product_code = v.prod join public.box_types b on b.box_code = v.box;
insert into public.price_list (farm_id, product_id, currency, price_per_stem, valid_from)
select f.id, p.id, 'USD', v.price, '2026-01-01'
from (values ('KIBO', 'ROS-ER-70', 0.32), ('NAKU', 'ROS-ER-70', 0.30), ('NAKU', 'ROS-MR-40', 0.085), ('KIBO', 'ROS-KD-60', 0.31), ('OLER', 'ROS-RV-50', 0.22)) as v (farm, prod, price)
join public.farms f on f.farm_code = v.farm join public.products p on p.product_code = v.prod;

-- Everything below runs as the demo Admin, through the same functions the app uses.
set request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000a';
set role authenticated;

select public.save_label_template(null, 'Standard box label', null, true, 150, 70, 'rotated', '{"version":1,"elements":[{"id":"logo","type":"logo","variant":"full","x":4,"y":4,"w":42,"h":16.2},{"id":"qr","type":"qr","x":108,"y":4,"w":38,"h":38},{"id":"box_id","type":"box_id","x":104,"y":43,"w":42,"h":5,"fontPt":9,"bold":false,"align":"center","caption":"en"},{"id":"box_count","type":"box_count","x":104,"y":49,"w":42,"h":8,"fontPt":16,"bold":true,"align":"center","caption":"en","style":"words"},{"id":"reprint","type":"reprint","x":111,"y":60,"w":28,"h":6},{"id":"f-customer_name","type":"field","field":"customer_name","x":4,"y":22,"w":98,"h":7,"fontPt":14,"bold":true,"align":"left","caption":"none"},{"id":"f-destination_airport","type":"field","field":"destination_airport","x":4,"y":30,"w":60,"h":6,"fontPt":12,"bold":true,"align":"left","caption":"en"},{"id":"f-variety","type":"field","field":"variety","x":4,"y":37,"w":98,"h":8,"fontPt":16,"bold":true,"align":"left","caption":"none"},{"id":"f-grade","type":"field","field":"grade","x":4,"y":46,"w":30,"h":5.5,"fontPt":11,"bold":false,"align":"left","caption":"en"},{"id":"f-stem_length","type":"field","field":"stem_length","x":36,"y":46,"w":40,"h":5.5,"fontPt":11,"bold":false,"align":"left","caption":"en"},{"id":"f-stems_per_bunch","type":"field","field":"stems_per_bunch","x":4,"y":52.5,"w":48,"h":5,"fontPt":10,"bold":false,"align":"left","caption":"en"},{"id":"f-bunches_per_box","type":"field","field":"bunches_per_box","x":54,"y":52.5,"w":48,"h":5,"fontPt":10,"bold":false,"align":"left","caption":"en"},{"id":"f-farm_name","type":"field","field":"farm_name","x":4,"y":58.5,"w":98,"h":5,"fontPt":10,"bold":false,"align":"left","caption":"en"},{"id":"f-shipment_ref","type":"field","field":"shipment_ref","x":4,"y":64,"w":98,"h":4.5,"fontPt":9,"bold":false,"align":"left","caption":"en"}]}'::jsonb);

insert into public.shipments (shipment_ref, flight_no, flight_date, destination_airport, mawb) values
  ('SHP-2026-0101', 'EK 720', current_date + 4, 'NRT', '176-61540743'),
  ('SHP-2026-0102', 'KQ 112', current_date + 6, 'AMS', null);

-- PFJ order: line 1 split across two farms, all confirmed and boxed.
create temp table demo (name text primary key, id uuid);
grant all on demo to authenticated;
insert into demo select 'O1', (public.create_customer_order(
  (select id from public.customers where customer_code = 'PFJ'),
  (select id from public.shipments where shipment_ref = 'SHP-2026-0101'), current_date + 2,
  jsonb_build_array(
    jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-ER-70'), 'stems', 1000),
    jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-MR-40'), 'stems', 500, 'notes', 'Bunching by 3'),
    jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-KD-60'), 'stems', 320))) ->> 'order_id')::uuid;
select public.allocate_order_line((select id from public.customer_order_lines where order_id = (select id from demo where name = 'O1') and line_no = 1), (select id from public.farms where farm_code = 'KIBO'), 600);
select public.allocate_order_line((select id from public.customer_order_lines where order_id = (select id from demo where name = 'O1') and line_no = 1), (select id from public.farms where farm_code = 'NAKU'), 400);
select public.allocate_order_line((select id from public.customer_order_lines where order_id = (select id from demo where name = 'O1') and line_no = 2), (select id from public.farms where farm_code = 'NAKU'), 500);
select public.allocate_order_line((select id from public.customer_order_lines where order_id = (select id from demo where name = 'O1') and line_no = 3), (select id from public.farms where farm_code = 'KIBO'), 320,
  (select id from public.box_types where box_code = 'QB'));
insert into public.order_charges (order_id, description, amount, sort_order) values
  ((select id from demo where name = 'O1'), 'Consolidation fee', 80, 1), ((select id from demo where name = 'O1'), 'Data logger', 26, 2);
select public.send_purchase_order(id) from public.purchase_orders where order_id = (select id from demo where name = 'O1');
select public.respond_purchase_order(id, true) from public.purchase_orders where order_id = (select id from demo where name = 'O1');
select public.assign_boxes(id) from public.purchase_orders where order_id = (select id from demo where name = 'O1') order by po_number;
-- Some boxes already through QC, so the scanner and labels have something to show.
select public.qc_scan(gen_random_uuid(), (select id from public.shipments where shipment_ref = 'SHP-2026-0101'), id)
from public.boxes where shipment_id = (select id from public.shipments where shipment_ref = 'SHP-2026-0101') and buyer_box_no <= 4;
select public.qc_record(gen_random_uuid(), array(select id from public.boxes where shipment_id = (select id from public.shipments where shipment_ref = 'SHP-2026-0101') and buyer_box_no <= 3), 'pass');

-- BLM order: placed, waiting for farms.
insert into demo select 'O2', (public.create_customer_order(
  (select id from public.customers where customer_code = 'BLM'),
  (select id from public.shipments where shipment_ref = 'SHP-2026-0102'), current_date + 4,
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-RV-50'), 'stems', 2000))) ->> 'order_id')::uuid;
select public.allocate_order_line((select id from public.customer_order_lines where order_id = (select id from demo where name = 'O2')), (select id from public.farms where farm_code = 'OLER'), 1200);
select public.allocate_order_line((select id from public.customer_order_lines where order_id = (select id from demo where name = 'O2')), (select id from public.farms where farm_code = 'KIBO'), 800);
select public.send_purchase_order(id) from public.purchase_orders where order_id = (select id from demo where name = 'O2');

reset role;
reset request.jwt.claim.sub;
