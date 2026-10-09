-- PREVIEW ONLY, runs once: a fresh test order for Pacific Floral Japan GK on a new shipment, made now (after
-- Odoo go-live), so its invoice can go to the real Odoo as a draft with "Send to Odoo". Every stem is placed with
-- a farm, boxed, checked and paid, then the shipment is closed, which makes the invoice.
-- Built through the app's own functions as the demo Admin (two-factor and the legal check paused for this step, then put back).

create temp table tf_saved on commit drop as
  select (select two_factor_roles from public.security_settings) as roles,
         (select legal_ok from public.profiles where id = 'd0000000-0000-0000-0000-00000000000a') as legal_ok;
update public.security_settings set two_factor_roles = '{}';
update public.profiles set legal_ok = true where id = 'd0000000-0000-0000-0000-00000000000a';
set local request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000a';

do $$
declare
  v_ship uuid;
  v_order uuid;
  v_po record;
  v_prod record;
  v_buyer uuid := (select id from public.customers where customer_code = 'PFJ');
begin
  insert into public.shipments (shipment_ref, flight_no, flight_date, destination_airport, mawb)
  values ('SHP-TEST-0001', 'EK 720', current_date + 2, 'NRT', '176-99990011')
  returning id into v_ship;

  v_order := (public.create_customer_order(v_buyer, v_ship, current_date + 2,
    jsonb_build_array(
      jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-ER-70'), 'stems', 600),
      jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-RV-50'), 'stems', 400))) ->> 'order_id')::uuid;
  perform public.allocate_order_line(l.id,
    case p.product_code when 'ROS-ER-70' then (select id from public.farms where farm_code = 'KIBO') else (select id from public.farms where farm_code = 'OLER') end,
    l.stems)
  from public.customer_order_lines l join public.products p on p.id = l.product_id where l.order_id = v_order;
  -- The buyer's catalog price, frozen on the order.
  for v_prod in select l.id, l.product_id from public.customer_order_lines l where l.order_id = v_order loop
    update public.customer_order_lines set quoted_price_per_stem = (
      select price from public.sell_price_in('FOB', v_prod.product_id, current_date, (select currency from public.customers where id = v_buyer)))
    where id = v_prod.id;
  end loop;
  for v_po in select id from public.purchase_orders where order_id = v_order loop
    perform public.send_purchase_order(v_po.id);
    perform public.respond_purchase_order(v_po.id, true);
  end loop;
  perform public.assign_boxes(id) from public.purchase_orders where order_id = v_order and status = 'confirmed' order by po_number;
  perform public.mark_order_paid(v_order, 'TEST-PREPAID');

  perform public.qc_scan(gen_random_uuid(), v_ship, b.id) from public.boxes b where b.shipment_id = v_ship and b.status = 'active';
  perform public.qc_record(gen_random_uuid(), array(select id from public.boxes where shipment_id = v_ship and status = 'active' and qc_status = 'pending'), 'pass');
  -- Closing the shipment makes Pacific Floral's invoice for this flight.
  update public.shipments set status = 'closed', closed_at = now() where id = v_ship;
end $$;

update public.security_settings set two_factor_roles = (select roles from tf_saved);
update public.profiles set legal_ok = (select legal_ok from tf_saved) where id = 'd0000000-0000-0000-0000-00000000000a';
