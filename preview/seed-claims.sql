-- Preview demo data for buyer claims (item 10). Runs once, as the database owner.
-- PREVIEW ONLY: a 30-day claim window, so the demo buyer can still report on the past weeks' flights.
update public.ordering_settings set claim_window_hours = 720;

-- The demo accounts accept their legal documents and two-factor themselves at sign-in; while this runs,
-- the claim functions act as them, so both are paused and put back at the end.
create temp table keep_legal as select id, legal_ok from public.profiles;
update public.profiles set legal_ok = true;
create temp table keep_2fa as select two_factor_roles from public.security_settings;
update public.security_settings set two_factor_roles = '{}';

-- Claim 1 (decided): Pacific Floral on a flight three weeks ago. A Kibo box with botrytis is approved,
-- a box of open flowers is denied. Kibo (the demo farm) gets a claim notice to answer.
set request.jwt.claim.sub = 'd0000000-0000-0000-0000-0000000000b1';
create temp table demo_claim as
select public.submit_claim(s.id,
  jsonb_build_array(
    jsonb_build_object('box_id', (select b.box_id from public.claimable_boxes() b join public.boxes x on x.id = b.box_id join public.farms f on f.id = x.farm_id
                                  where b.shipment_id = s.id and f.farm_code = 'KIBO' order by b.box_id limit 1),
                       'reason', 'botrytis', 'stems', 40, 'note', 'Grey mould on about half the heads'),
    jsonb_build_object('box_id', (select b.box_id from public.claimable_boxes() b join public.boxes x on x.id = b.box_id join public.farms f on f.id = x.farm_id
                                  where b.shipment_id = s.id and f.farm_code = 'OLER' order by b.box_id limit 1),
                       'reason', 'too_open', 'stems', 20)),
  '[{"description": "Disposal of the mouldy stems", "amount": 12}]', 'Two boxes from Monday''s flight') as r
from public.shipments s where s.shipment_ref = 'SHP-2026-0087';

set request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000c';
select public.decide_claim_line(l.id, true, null, null)
from public.claim_lines l where l.claim_id = (select (r ->> 'claim_id')::uuid from demo_claim) and l.reason = 'botrytis';
select public.decide_claim_line(l.id, false, null, 'Stage 3 opening was agreed for this order')
from public.claim_lines l where l.claim_id = (select (r ->> 'claim_id')::uuid from demo_claim) and l.reason = 'too_open';
select public.decide_claim_cost(c.id, true, null, (select id from public.farms where farm_code = 'KIBO'), null)
from public.claim_costs c where c.claim_id = (select (r ->> 'claim_id')::uuid from demo_claim);
select public.finish_claim_review((select (r ->> 'claim_id')::uuid from demo_claim), 'Thank you for the photos.');

-- Claim 2 (waiting for review): last week's flight.
set request.jwt.claim.sub = 'd0000000-0000-0000-0000-0000000000b1';
select public.submit_claim(s.id,
  jsonb_build_array(
    jsonb_build_object('box_id', (select b.box_id from public.claimable_boxes() b where b.shipment_id = s.id order by b.box_id limit 1),
                       'reason', 'damage', 'stems', 25, 'note', 'Box crushed in transit, stems broken'),
    jsonb_build_object('box_id', (select b.box_id from public.claimable_boxes() b where b.shipment_id = s.id order by b.box_id desc limit 1),
                       'reason', 'wrong_length', 'stems', 40, 'note', 'Stems around 50 cm, ordered 70 cm')),
  '[]', null)
from public.shipments s where s.shipment_ref = 'SHP-2026-0089';

reset request.jwt.claim.sub;
update public.profiles p set legal_ok = k.legal_ok from keep_legal k where k.id = p.id;
update public.security_settings set two_factor_roles = (select two_factor_roles from keep_2fa);
