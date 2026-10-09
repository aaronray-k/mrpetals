-- Preview demo data for the dashboards (item 6). Runs once, after seed-ordering.sql.
-- Bloem buys in EUR, so the catalog needs a USD -> EUR rate. Then eight weeks of past flights,
-- built through the same functions the app uses and moved back in time afterwards.

insert into public.exchange_rates (from_currency, to_currency, rate, valid_from) values ('USD', 'EUR', 0.92, '2026-01-01');
-- CPT prices carry the freight, so a bigger margin; set in EUR for the European buyers.
insert into public.margin_rules (incoterm, min_length_cm, max_length_cm, margin_per_stem, currency) values
  ('CPT', 0, 50, 0.06, 'EUR'), ('CPT', 51, null, 0.08, 'EUR');

set request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000a';

do $$
declare
  k int;
  v_day date;
  v_ship uuid;
  v_order uuid;
  v_buyer text;
  v_boxes bigint[];
  v_po record;
  v_prod record;
  v_kibo uuid := (select id from public.farms where farm_code = 'KIBO');
  v_naku uuid := (select id from public.farms where farm_code = 'NAKU');
  v_oler uuid := (select id from public.farms where farm_code = 'OLER');
begin
  for k in 1..8 loop
    v_day := current_date - 7 * k + 1;
    -- A future flight while the functions run (they refuse past flights); dated back below.
    insert into public.shipments (shipment_ref, flight_no, flight_date, destination_airport, mawb)
    values ('SHP-2026-' || lpad((90 - k)::text, 4, '0'), 'EK 720', current_date + 40 + k, 'NRT', '176-6154' || lpad((1000 + k)::text, 4, '0'))
    returning id into v_ship;

    foreach v_buyer in array (case when k % 2 = 0 then array['PFJ', 'BLM'] else array['PFJ'] end) loop
      v_order := (public.create_customer_order(
        (select id from public.customers where customer_code = v_buyer), v_ship, current_date + 38 + k,
        jsonb_build_array(
          jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-ER-70'), 'stems', 600 + 80 * (k % 3)),
          jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-RV-50'), 'stems', 400 + 100 * (k % 2)),
          jsonb_build_object('product_id', (select id from public.products where product_code = 'ROS-MR-40'), 'stems', 500))) ->> 'order_id')::uuid;
      perform public.allocate_order_line(l.id,
        case p.product_code when 'ROS-ER-70' then (case when k % 3 = 0 then v_kibo else v_naku end) when 'ROS-RV-50' then v_oler else v_naku end,
        l.stems)
      from public.customer_order_lines l join public.products p on p.id = l.product_id where l.order_id = v_order;
      -- The buyer's price, frozen as if it came from the catalog.
      for v_prod in select l.id, l.product_id from public.customer_order_lines l where l.order_id = v_order loop
        update public.customer_order_lines set quoted_price_per_stem = (
          select price from public.sell_price_in(
            (select incoterm from public.customers where customer_code = v_buyer), v_prod.product_id, v_day,
            (select currency from public.customers where customer_code = v_buyer)))
        where id = v_prod.id;
      end loop;
      for v_po in select id, farm_id from public.purchase_orders where order_id = v_order loop
        perform public.send_purchase_order(v_po.id);
        -- Oleria comes up 100 stems short every third week; ConsolFlora moves those to Kibo.
        if v_po.farm_id = v_oler and k % 3 = 1 then
          perform public.answer_purchase_order(v_po.id,
            (select jsonb_agg(jsonb_build_object('po_line_id', pl.id, 'stems', pl.stems - 100)) from public.purchase_order_lines pl where pl.po_id = v_po.id),
            null, null);
        else
          perform public.respond_purchase_order(v_po.id, true);
        end if;
      end loop;
      perform public.assign_boxes(id) from public.purchase_orders where order_id = v_order and status = 'confirmed' order by po_number;
      if k > 1 or v_buyer = 'PFJ' then
        perform public.mark_order_paid(v_order, 'DEMO-' || k);
        update public.customer_orders set paid_at = v_day - 2 where id = v_order;
      end if;
      update public.customer_orders set created_at = v_day - 3, ship_date = v_day, farm_delivery_date = v_day - 2 where id = v_order;
      update public.purchase_orders set sent_at = v_day - 3 + time '08:00', responded_at = v_day - 3 + time '15:00', delivery_date = v_day - 2 where order_id = v_order;
    end loop;

    -- QC: every box received; most pass.
    perform public.qc_scan(gen_random_uuid(), v_ship, b.id) from public.boxes b where b.shipment_id = v_ship and b.status = 'active';
    select array_agg(id order by id) into v_boxes from public.boxes where shipment_id = v_ship and status = 'active';
    -- One box back to farm every other week (pests are always Critical), one Minor from Oleria.
    if k % 2 = 0 then
      perform public.qc_record(gen_random_uuid(), array[v_boxes[1]], 'critical', array['pests'], null);
    end if;
    perform public.qc_record(gen_random_uuid(), array[b.id], 'minor', array['too_open'], null)
    from (select id from public.boxes where shipment_id = v_ship and qc_status = 'pending' and farm_id = v_oler order by id limit 1) b;
    perform public.qc_record(gen_random_uuid(), array(select id from public.boxes where shipment_id = v_ship and status = 'active' and qc_status = 'pending'), 'pass');
    update public.boxes set received_at = v_day - 1 + time '09:00', qc_at = v_day - 1 + time '11:00' where shipment_id = v_ship;
    update public.qc_events set happened_at = v_day - 1 + time '11:00' where box_id in (select id from public.boxes where shipment_id = v_ship);
    update public.shipments set flight_date = v_day where id = v_ship;
    update public.shipments set status = 'closed', closed_at = v_day + time '06:00' where id = v_ship;
  end loop;
end $$;

reset request.jwt.claim.sub;
