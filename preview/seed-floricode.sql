-- Preview demo data for Floricode (item 7). Runs once, right after the first demo sync
-- (start.mjs loads src/server/floricode-demo.json), as the database owner.

-- The demo products take their VBN codes and features from the synced lists.
update public.products p set vbn_code = v.vbn, floricode_product_id = v.vbn, floricode_features = v.features::jsonb,
  head_size_cm = coalesce(v.head, p.head_size_cm), maturity = coalesce(v.maturity, p.maturity)
from (values
  ('ROS-ER-70', '13000', '{"S20": "070", "Q01": "A1", "S62": "055", "S98": "2"}', 5.5, 'Stage 2'),
  ('ROS-MR-40', '13007', '{"S20": "040", "Q01": "A1", "S98": "2"}', null, 'Stage 2'),
  ('ROS-KD-60', '13014', '{"S20": "060", "Q01": "A1", "S62": "050"}', 5.0, null),
  ('ROS-RV-50', '13021', '{"S20": "050", "Q01": "A1"}', null, null)
) as v (code, vbn, features, head, maturity)
where p.product_code = v.code;

-- One product loaded before Floricode, still without a code: it shows as "Needs a VBN code".
insert into public.products (product_code, flower_type, variety, colour, grade, stem_length_cm, stems_per_bunch)
values ('ROS-SW-50', 'Rose', 'Sweetness', 'Lilac', 'A1', 50, 20);

-- Box types take Floricode packaging codes; farms and buyers their GLNs from the company register.
update public.box_types set vbn_packaging_code = case box_code when 'QB' then '901' when 'HB' then '902' end where box_code in ('QB', 'HB');
update public.farms f set gln = c.gln from public.floricode_companies c where c.name = f.farm_name;
update public.customers k set gln = c.gln from public.floricode_companies c where c.name = k.company_name;

select public.review_products();
