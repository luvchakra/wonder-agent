-- Integration Agent — INTEGRATION-P0-01.3
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.

create table integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_id uuid not null references integrations(id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'partial')),
  started_at timestamptz,
  ended_at timestamptz,
  records_processed integer not null default 0,
  records_failed integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  retry_count integer not null default 0,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index integration_sync_jobs_integration_id_idx on integration_sync_jobs (integration_id, created_at desc);
create index integration_sync_jobs_tenant_id_idx on integration_sync_jobs (tenant_id);

alter table integration_sync_jobs enable row level security;

-- Creating a job (always starts 'queued', all counters at their defaults) is
-- harmless for a client to do directly, tenant-scoped + integration.execute
-- checked in the API route. But job *results* (status transitions, counts,
-- errors) are integrity-sensitive the same way Identity's
-- agent_lifecycle_events is — only the trusted sync-execution path
-- (modules/integrations/syncJobs.ts, via supabaseServiceRole()) may update a
-- job afterward, so a tenant member can never forge a "succeeded, 500
-- records imported" result directly via REST. Hence: SELECT + INSERT for
-- authenticated clients, no UPDATE policy at all.
create policy integration_sync_jobs_select on integration_sync_jobs
  for select
  using (tenant_id in (select current_tenant_ids()));

-- The WITH CHECK below closes a loophole a bare tenant check would leave
-- open: without it, a client could still INSERT a row claiming
-- status = 'succeeded' with fabricated counts on day one, since INSERT
-- accepts any column value, not just defaults. A freshly created job must
-- always start life queued, with no result fields populated yet.
create policy integration_sync_jobs_insert on integration_sync_jobs
  for insert
  with check (
    tenant_id in (select current_tenant_ids())
    and status = 'queued'
    and started_at is null
    and ended_at is null
    and records_processed = 0
    and records_failed = 0
    and errors = '[]'::jsonb
  );
