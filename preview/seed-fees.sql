-- Preview demo data for service fees. Pacific Floral (PFJ) takes the Full package (the default);
-- Bloem (BLM) takes Consolidation only, so the two show the difference: per-stem fee plus 100 per
-- shipment, against farm prices plus 80 per shipment.
update public.customers set service = 'consolidation' where customer_code = 'BLM';
