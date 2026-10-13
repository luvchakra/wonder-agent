-- §15 (QA 2026-10-12 follow-up): a campaign's items are built after the
-- launch returns, so a large organization's launch never makes a person
-- wait. The campaign records how its build went:
-- - building: items are being created;
-- - ready: done, items_total items;
-- - failed: stopped with build_error; no undecided items were left behind.
-- Existing campaigns were built during their launch, so they are ready.

alter table certification_campaigns
  add column build_status text not null default 'ready' check (build_status in ('building', 'ready', 'failed')),
  add column build_error text check (build_error is null or char_length(build_error) <= 500),
  add column items_total integer check (items_total is null or items_total >= 0),
  add column built_at timestamptz;

create index certification_campaigns_building_idx on certification_campaigns (created_at) where build_status = 'building';

-- §15: a campaign's counts from the database, one query for a page,
-- instead of reading every item to count it. Security invoker, so RLS
-- applies; the tenant is passed explicitly as well (§14).
create function campaign_item_counts(p_tenant uuid, p_campaign uuid default null)
returns table (campaign_id uuid, total bigint, pending bigint, decided bigint, overdue bigint, escalated bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select i.campaign_id,
         count(*),
         count(*) filter (where i.status = 'pending'),
         count(*) filter (where i.status = 'decided'),
         count(*) filter (where i.status = 'pending' and i.due_date < now()),
         count(*) filter (where i.escalated_at is not null)
  from certification_items i
  where i.tenant_id = p_tenant
    and (p_campaign is null or i.campaign_id = p_campaign)
  group by i.campaign_id;
$$;
revoke execute on function campaign_item_counts(uuid, uuid) from public, anon;
grant execute on function campaign_item_counts(uuid, uuid) to authenticated;
