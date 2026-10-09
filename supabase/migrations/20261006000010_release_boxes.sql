-- The release gate also checks the boxes: each must be received, passed by QC and labelled before
-- the shipment closes (Admin can still close anyway, with a logged reason).
create or replace function public.shipment_blockers(p_shipment_id uuid)
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(x order by x), '{}') from (
    select coalesce(c.company_name, 'Shipment') || ': ' ||
           case d when 'phyto' then 'KEPHIS phytosanitary certificate' when 'certificate_of_origin' then 'certificate of origin' else 'customs export entry' end
           || ' missing' as x
    from shipment_release r left join customers c on c.id = r.customer_id, unnest(r.missing_documents) d
    where r.shipment_id = p_shipment_id
    union all
    select coalesce(c.company_name, 'Shipment') || ': ' ||
           case d when 'phyto' then 'KEPHIS phytosanitary certificate' when 'certificate_of_origin' then 'certificate of origin' else 'customs export entry' end
           || ' not checked yet'
    from shipment_release r left join customers c on c.id = r.customer_id, unnest(r.unchecked_documents) d
    where r.shipment_id = p_shipment_id
    union all
    select c.company_name || ': prepaid order ' || o || ' not paid'
    from shipment_release r join customers c on c.id = r.customer_id, unnest(r.unpaid_prepaid_orders) o
    where r.shipment_id = p_shipment_id
    union all
    -- Boxes go to the airline only once received, checked and labelled.
    select c.company_name || ': ' || count(*) || case when count(*) = 1 then ' box' else ' boxes' end || ' ' ||
           case k when 1 then 'not received yet' when 2 then 'not passed by QC yet' else 'without a label yet' end
    from boxes b join customers c on c.id = b.customer_id
    cross join lateral (select case when b.received_at is null then 1 when b.qc_status <> 'passed' then 2
                                    when not exists (select 1 from label_prints lp where lp.box_id = b.id) then 3 end as k) x
    where b.shipment_id = p_shipment_id and b.status = 'active' and x.k is not null
    group by c.company_name, k
  ) t
$$;
