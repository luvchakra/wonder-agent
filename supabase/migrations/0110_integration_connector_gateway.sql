-- Integration Agent — the Connector Gateway's traffic ledger.
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.
--
-- User requirement (2026-10-10): "all such connections should pass through
-- one gateway which sits between WonderID and external world". Every
-- connection's traffic, outbound (the http, mcp, ldap and sql drivers) and
-- inbound (the /api/connect receivers), passes through
-- modules/integrations/gateway. It enforces the connection's policies in one
-- place and accounts for what passed.
--
-- 1. connector_traffic: per connection, per minute, per (direction,
--    operation, host, outcome, error category), how many requests passed,
--    their bytes and their total duration. Never a path, a query string, a
--    header or a credential: the host name only, and for inbound traffic no
--    host at all (the sender's address is not recorded).
--    - The gateway aggregates in memory and writes once per session (a sync,
--      a connection test, a received request) through
--      record_connector_traffic(), which adds to the minute's row rather
--      than inserting one row per request.
--    - integration_id is null only for a connector preview: a run of an
--      unsaved definition, which has no connection yet but is still the
--      organization's egress.
--    - Members of the organization read it (as integration_sync_jobs); no
--      client writes it. Only the service role records or purges.
-- 2. connector_traffic_summary(): totals per connection since a time, paged
--    at the database. SECURITY INVOKER, so RLS applies on top of its own
--    explicit tenant filter.
-- 3. purge_connector_traffic(): removes rows older than 30 days; the daily
--    cron calls it (app/api/cron/privacy, the retention job).

create table connector_traffic (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_id uuid,
  window_start timestamptz not null,
  direction text not null check (direction in ('outbound', 'inbound')),
  operation text not null check (char_length(operation) between 1 and 64),
  host text check (host is null or char_length(host) between 1 and 253),
  outcome text not null check (outcome in ('ok', 'error', 'blocked')),
  error_category text check (error_category is null or char_length(error_category) between 1 and 40),
  requests integer not null default 0 check (requests >= 0),
  bytes_in bigint not null default 0 check (bytes_in >= 0),
  bytes_out bigint not null default 0 check (bytes_out >= 0),
  duration_ms bigint not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  -- Same-tenant reference (as migration 0076): a row can never name another
  -- organization's connection.
  foreign key (integration_id, tenant_id) references integrations (id, tenant_id) on delete cascade,
  check (window_start = date_trunc('minute', window_start))
);

-- One row per minute bucket; record_connector_traffic() adds to it.
create unique index connector_traffic_bucket_key on connector_traffic
  (tenant_id, integration_id, window_start, direction, operation, host, outcome, error_category) nulls not distinct;
create index connector_traffic_tenant_window_idx on connector_traffic (tenant_id, window_start desc);
create index connector_traffic_integration_window_idx on connector_traffic (integration_id, window_start desc);

alter table connector_traffic enable row level security;

create policy connector_traffic_select on connector_traffic
  for select using (tenant_id in (select current_tenant_ids()));
-- No insert, update or delete policy: only the gateway (service role) records.

-- Adds one session's aggregated rows to their minute buckets. Each row's
-- connection must belong to the row's organization (the foreign key above
-- refuses it otherwise); the caller sets tenant_id from the connection row.
create or replace function record_connector_traffic(p_rows jsonb)
returns integer
language sql
security invoker
set search_path = public
as $$
  with rows as (
    select *
    from jsonb_to_recordset(p_rows) as r(
      tenant_id uuid, integration_id uuid, window_start timestamptz, direction text, operation text,
      host text, outcome text, error_category text, requests integer, bytes_in bigint, bytes_out bigint, duration_ms bigint
    )
  ), written as (
    insert into connector_traffic as t
      (tenant_id, integration_id, window_start, direction, operation, host, outcome, error_category, requests, bytes_in, bytes_out, duration_ms)
    select tenant_id, integration_id, date_trunc('minute', window_start), direction, operation, host, outcome, error_category,
           requests, bytes_in, bytes_out, duration_ms
    from rows
    on conflict (tenant_id, integration_id, window_start, direction, operation, host, outcome, error_category)
    do update set
      requests = t.requests + excluded.requests,
      bytes_in = t.bytes_in + excluded.bytes_in,
      bytes_out = t.bytes_out + excluded.bytes_out,
      duration_ms = t.duration_ms + excluded.duration_ms
    returning 1
  )
  select count(*)::integer from written;
$$;

revoke execute on function record_connector_traffic(jsonb) from public, anon, authenticated;
grant execute on function record_connector_traffic(jsonb) to service_role;

-- Totals per connection since a time, busiest first, paged at the database.
-- p_integration_id narrows it to one connection (the integration page).
create or replace function connector_traffic_summary(
  p_tenant_id uuid,
  p_since timestamptz,
  p_integration_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  integration_id uuid,
  integration_name text,
  requests bigint,
  errors bigint,
  blocked bigint,
  bytes_in bigint,
  bytes_out bigint,
  avg_duration_ms bigint,
  last_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select t.integration_id,
         i.name,
         sum(t.requests)::bigint,
         coalesce(sum(t.requests) filter (where t.outcome = 'error'), 0)::bigint,
         coalesce(sum(t.requests) filter (where t.outcome = 'blocked'), 0)::bigint,
         sum(t.bytes_in)::bigint,
         sum(t.bytes_out)::bigint,
         (sum(t.duration_ms) / nullif(sum(t.requests), 0))::bigint,
         max(t.window_start),
         count(*) over ()
  from connector_traffic t
  left join integrations i on i.id = t.integration_id and i.tenant_id = t.tenant_id
  where t.tenant_id = p_tenant_id
    and t.window_start >= p_since
    and (p_integration_id is null or t.integration_id = p_integration_id)
  group by t.integration_id, i.name
  order by sum(t.requests) desc, t.integration_id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

revoke execute on function connector_traffic_summary(uuid, timestamptz, uuid, integer, integer) from public, anon;
grant execute on function connector_traffic_summary(uuid, timestamptz, uuid, integer, integer) to authenticated, service_role;

-- Retention: the ledger is operational telemetry, kept 30 days.
create or replace function purge_connector_traffic(p_older_than interval default interval '30 days')
returns integer
language sql
security invoker
set search_path = public
as $$
  with gone as (
    delete from connector_traffic where window_start < now() - greatest(p_older_than, interval '1 day') returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function purge_connector_traffic(interval) from public, anon, authenticated;
grant execute on function purge_connector_traffic(interval) to service_role;
