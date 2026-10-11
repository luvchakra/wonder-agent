-- Access Agent — ACCESS-P0-27: entitlement and access-grant reconciliation
-- from connectors.
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.
--
-- A connector imports an application's entitlements (groups, roles,
-- permissions) and who holds which. Until now only a CSV on an object page
-- could put them into `entitlements` and `access_grants`; this lets a
-- connector do the same, and keep them in step with the source:
--
-- 1. entitlements.source_integration_id / external_ref: which connection an
--    entitlement came from, and its id there (a group's DN, a role's id).
--    A connector's grant names its entitlement by that id, not by name, so
--    the pair is unique per application. Null for entitlements entered by
--    hand or by file, which a connector adopts by name the first time.
-- 2. entitlements.missing_from_source_at / access_grants.missing_from_source_at:
--    when a full reconciliation last found the entitlement or the grant gone
--    from the source. Never a delete and never a revoke (removing access is
--    a governed action, #7 and #15), the same as accounts' column of that
--    name (0089). A later run that sees it again clears the time. The access
--    ledger reads the grant's time, so removal and return are ledger events.
-- 3. access_reconciliation_runs: one row per preview or apply, with what it
--    found (counts, samples) and the plan's hash, so an apply can prove it
--    writes exactly what the preview showed. Members read their own
--    organization's runs; only the service role writes them.

alter table entitlements
  add column source_integration_id uuid,
  add column external_ref text check (external_ref is null or length(external_ref) between 1 and 500),
  add column missing_from_source_at timestamptz,
  add constraint entitlements_source_integration_fkey
    foreign key (source_integration_id, tenant_id) references integrations (id, tenant_id) on delete set null (source_integration_id);

create unique index entitlements_source_ref_key
  on entitlements (tenant_id, application_id, source_integration_id, external_ref)
  where external_ref is not null and source_integration_id is not null;
create index entitlements_source_integration_idx on entitlements (source_integration_id) where source_integration_id is not null;

alter table access_grants add column missing_from_source_at timestamptz;

create table access_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  application_id uuid not null,
  integration_id uuid,
  mode text not null check (mode in ('full', 'incremental')),
  dry_run boolean not null default false,
  status text not null check (status in ('succeeded', 'failed')),
  plan_hash text,
  counts jsonb not null default '{}'::jsonb,
  samples jsonb not null default '{}'::jsonb,
  error text,
  -- The preview this apply carried out, when it came from one.
  preview_run_id uuid references access_reconciliation_runs (id) on delete set null,
  triggered_by uuid references users (id) on delete set null,
  sync_job_id uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint access_reconciliation_runs_application_fkey foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  constraint access_reconciliation_runs_integration_fkey foreign key (integration_id, tenant_id) references integrations (id, tenant_id) on delete set null (integration_id)
);

alter table access_reconciliation_runs enable row level security;

create policy access_reconciliation_runs_select on access_reconciliation_runs
  for select using (tenant_id in (select current_tenant_ids()));

create index access_reconciliation_runs_app_idx on access_reconciliation_runs (tenant_id, application_id, started_at desc);
create index access_reconciliation_runs_integration_idx on access_reconciliation_runs (integration_id) where integration_id is not null;
create index access_reconciliation_runs_preview_idx on access_reconciliation_runs (preview_run_id) where preview_run_id is not null;
create index access_reconciliation_runs_triggered_by_idx on access_reconciliation_runs (triggered_by) where triggered_by is not null;

-- Indexes covering the same-tenant foreign keys in their own column order
-- (the performance advisor flagged the three above as not covering them).
create index entitlements_source_integration_fk_idx on entitlements (source_integration_id, tenant_id) where source_integration_id is not null;
create index access_reconciliation_runs_application_fk_idx on access_reconciliation_runs (application_id, tenant_id);
create index access_reconciliation_runs_integration_fk_idx on access_reconciliation_runs (integration_id, tenant_id) where integration_id is not null;
