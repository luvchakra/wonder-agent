-- Integration Agent — INTEGRATION-P0-01.4
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.

create table integration_objects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  integration_id uuid not null references integrations(id) on delete cascade,
  object_type text not null check (object_type in (
    'identity', 'account', 'application', 'entitlement', 'access_grant', 'policy', 'activity'
  )),
  external_id text not null,
  raw jsonb not null,
  normalized jsonb not null,
  sync_job_id uuid references integration_sync_jobs(id),
  imported_at timestamptz not null default now(),
  unique (integration_id, object_type, external_id)
);

create index integration_objects_tenant_id_idx on integration_objects (tenant_id);
create index integration_objects_integration_type_idx on integration_objects (integration_id, object_type);

alter table integration_objects enable row level security;

-- Read-only for clients. This is imported/normalized data written by the
-- sync worker (modules/integrations/syncJobs.ts, via
-- supabaseServiceRole()) — never hand-typed by a user, so there is no
-- legitimate client INSERT/UPDATE path at all, only SELECT.
create policy integration_objects_select on integration_objects
  for select
  using (tenant_id in (select current_tenant_ids()));
