-- Compliance Agent — COMPLIANCE-P0-10 (remainder): campaign analytics.
-- Counted in the database (§15), never by reading every item. Security
-- invoker, so RLS applies; the tenant is passed explicitly as well (§14).
-- Read-only and additive.

-- Decisions per campaign and outcome, with the average hours from the item
-- being opened to its decision. Only the latest decision of an item counts
-- (a deferred item decided later counts once, as its final outcome).
create function campaign_decision_counts(p_tenant uuid)
returns table (campaign_id uuid, decision text, decisions bigint, avg_hours numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select i.campaign_id, d.decision, count(*), round(avg(extract(epoch from (d.decided_at - i.created_at)) / 3600)::numeric, 1)
  from certification_items i
  join lateral (
    select x.decision, x.decided_at from certification_decisions x where x.item_id = i.id order by x.decided_at desc limit 1
  ) d on true
  where i.tenant_id = p_tenant
  group by i.campaign_id, d.decision;
$$;

-- Each reviewer's open items and how many are past due, most overdue first.
create function campaign_reviewer_backlog(p_tenant uuid)
returns table (reviewer_id uuid, pending bigint, overdue bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select i.reviewer_id, count(*), count(*) filter (where i.due_date < now())
  from certification_items i
  join certification_campaigns c on c.id = i.campaign_id and c.tenant_id = i.tenant_id
  where i.tenant_id = p_tenant and i.status = 'pending' and c.status = 'active' and i.reviewer_id is not null
  group by i.reviewer_id
  order by 3 desc, 2 desc
  limit 20;
$$;

revoke execute on function campaign_decision_counts(uuid) from public, anon;
revoke execute on function campaign_reviewer_backlog(uuid) from public, anon;
grant execute on function campaign_decision_counts(uuid) to authenticated;
grant execute on function campaign_reviewer_backlog(uuid) to authenticated;
