-- Preview demo data for the ordering flow (item 5). Runs once, after seed.sql.
set request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000a';
set role authenticated;

insert into public.shipments (shipment_ref, flight_no, flight_date, destination_airport) values
  ('SHP-2026-0110', 'EK 720', current_date + 9, 'NRT'),
  ('SHP-2026-0111', 'EK 720', current_date + 12, 'NRT'),
  ('SHP-2026-0112', 'KQ 112', current_date + 10, 'AMS');

-- Admin pins Naku for Madam Red on FOB.
insert into public.price_overrides (product_id, incoterm, pinned_farm_id)
select p.id, 'FOB', f.id from public.products p, public.farms f where p.product_code = 'ROS-MR-40' and f.farm_code = 'NAKU';

-- The PFJ buyer orders from the catalog: waiting for approval. (Buyers only see flights through
-- available_flights(), so look the flight up as Admin first.)
create temp table demo_flight as select id from public.shipments where shipment_ref = 'SHP-2026-0110';
grant select on demo_flight to authenticated;
set request.jwt.claim.sub = 'd0000000-0000-0000-0000-0000000000b1';
select public.place_order((select id from demo_flight), null,
  jsonb_build_array(
    jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-ER-70'), 'stems', 800, 'bunching', 'standard'),
    jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-KD-60'), 'stems', 400, 'bunching', 'custom', 'stems_per_bunch', 10, 'sleeves', true, 'bunch_labels', true),
    jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-RV-50'), 'stems', 300, 'bunching', 'consolflora')),
  'Mixed colours in each box if possible');
-- And sets up a standing order for Monday and Thursday flights.
select public.save_standing_order(null, null, array[1, 4],
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-ER-70'), 'stems', 640, 'bunching', 'standard')),
  true, current_date, null, 'Weekly Ever Red');

-- Bloem's order: Kibo answers its PO in part (500 of 800 stems).
set request.jwt.claim.sub = 'd0000000-0000-0000-0000-0000000000f1';
select public.answer_purchase_order(po.id,
  (select jsonb_agg(jsonb_build_object('po_line_id', pl.id, 'stems', 500)) from public.purchase_order_lines pl where pl.po_id = po.id),
  null, null)
from public.purchase_orders po join public.farms f on f.id = po.farm_id
where f.farm_code = 'KIBO' and po.status = 'sent';

reset role;
reset request.jwt.claim.sub;
-- Make this week's standing orders (the scheduler does this hourly from now on).
select public.generate_standing_orders();
