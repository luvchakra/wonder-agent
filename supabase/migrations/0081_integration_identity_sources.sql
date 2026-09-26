-- INTEGRATION-P0-08 / INTEGRATION-P0-09 (WonderID Phase 2, 2026-09-26) —
-- authoritative identity sources and the import/reconciliation pipeline.
--
-- An identity source is a role on top of the Integration module: a CSV
-- file, or the identity objects an existing integration (generic REST,
-- Saviynt, ...) already imports. It says which identity fields it is
-- authoritative for, its precedence, how its columns map to identity
-- fields, how its records are correlated to existing identities, and what
-- happens to identities that disappear from it (spec H2).
--
-- Writes to `identities` never happen here: the Identity module's
-- applySourcedIdentities() owns them (#5, #6). These tables record the
-- source's own state: which external record is which identity, every run
-- with its counts, and every ambiguous match waiting for a person.
--
-- RLS: members read their tenant's rows. Sources are written by members
-- (permission-checked in the service); links, runs and pending
-- correlations only by the reconciliation worker through the service role,
-- with explicit tenant filters, the integration_sync_jobs pattern (0022).

create table identity_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  template text not null check (template in ('csv', 'scim', 'rest', 'hr_api', 'integration')),
  integration_id uuid,
  identity_type text not null default 'HUMAN' check (identity_type in
    ('HUMAN', 'EXTERNAL', 'MACHINE', 'SERVICE_ACCOUNT', 'APPLICATION', 'WORKLOAD', 'API')),
  authoritative boolean not null default false,
  -- Lower wins. An authoritative HR feed is typically 10, a directory 50.
  priority integer not null default 100 check (priority between 1 and 1000),
  authoritative_fields text[] not null default '{}',
  -- [{ "source": "<column or field>", "target": "<identity field>" }]
  attribute_mappings jsonb not null default '[]'::jsonb check (jsonb_typeof(attribute_mappings) = 'array'),
  -- Ordered: [{ "kind": "email" | "username" | "composite", "fields": [...] }]
  correlation_rules jsonb not null default '[{"kind":"email"}]'::jsonb check (jsonb_typeof(correlation_rules) = 'array'),
  leaver_strategy text not null default 'disable' check (leaver_strategy in ('disable', 'flag', 'none')),
  -- A full run that would mark more than this share of linked identities
  -- as leavers applies none of them and asks for review instead.
  leaver_threshold_percent integer not null default 20 check (leaver_threshold_percent between 1 and 100),
  schedule text not null default 'manual' check (schedule in ('manual', 'daily', 'hourly')),
  status text not null default 'active' check (status in ('active', 'paused')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  check (template <> 'integration' or integration_id is not null),
  foreign key (integration_id, tenant_id) references integrations (id, tenant_id) on delete cascade
);
create unique index identity_sources_tenant_name_key on identity_sources (tenant_id, lower(name));
create index identity_sources_integration_fk_idx on identity_sources (integration_id, tenant_id);
create index identity_sources_created_by_idx on identity_sources (created_by);

alter table identity_sources enable row level security;
create policy identity_sources_select on identity_sources
  for select using (tenant_id in (select current_tenant_ids()));
create policy identity_sources_insert on identity_sources
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy identity_sources_update on identity_sources
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

create table identity_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_id uuid not null,
  trigger text not null check (trigger in ('upload', 'integration', 'manual')),
  -- 'full': the input is the whole population, so absent records are leavers.
  -- 'partial': only the records given; nobody is treated as a leaver.
  mode text not null default 'full' check (mode in ('full', 'partial')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'partial', 'failed')),
  records_seen integer not null default 0,
  records_invalid integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  pending_count integer not null default 0,
  leaver_count integer not null default 0,
  error_count integer not null default 0,
  guard_tripped boolean not null default false,
  errors jsonb not null default '[]'::jsonb,
  -- Capped per-record change log: [{ ref, identityId, action, changed }]
  changes jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (source_id, tenant_id) references identity_sources (id, tenant_id) on delete cascade
);
create index identity_reconciliation_runs_source_idx on identity_reconciliation_runs (source_id, tenant_id, created_at desc);
create index identity_reconciliation_runs_created_by_idx on identity_reconciliation_runs (created_by);

alter table identity_reconciliation_runs enable row level security;
create policy identity_reconciliation_runs_select on identity_reconciliation_runs
  for select using (tenant_id in (select current_tenant_ids()));

create table identity_source_links (
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 300),
  identity_id uuid not null,
  -- Whether the record was in the source's latest full run.
  present boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_run_id uuid,
  primary key (source_id, external_id),
  foreign key (source_id, tenant_id) references identity_sources (id, tenant_id) on delete cascade,
  foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  foreign key (last_run_id, tenant_id) references identity_reconciliation_runs (id, tenant_id) on delete set null (last_run_id)
);
-- One external record per identity per source.
create unique index identity_source_links_identity_key on identity_source_links (source_id, identity_id);
create index identity_source_links_tenant_source_idx on identity_source_links (source_id, tenant_id);
create index identity_source_links_identity_fk_idx on identity_source_links (identity_id, tenant_id);
create index identity_source_links_run_fk_idx on identity_source_links (last_run_id, tenant_id);

alter table identity_source_links enable row level security;
create policy identity_source_links_select on identity_source_links
  for select using (tenant_id in (select current_tenant_ids()));

create table pending_identity_correlations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_id uuid not null,
  run_id uuid,
  external_id text not null check (char_length(external_id) between 1 and 300),
  -- The mapped record, as the source supplied it (no secrets: identity attributes only).
  normalized jsonb not null default '{}'::jsonb,
  candidate_identity_ids uuid[] not null default '{}',
  reason text not null check (char_length(reason) between 1 and 300),
  status text not null default 'pending' check (status in ('pending', 'linked', 'created', 'dismissed')),
  resolved_identity_id uuid,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (source_id, tenant_id) references identity_sources (id, tenant_id) on delete cascade,
  foreign key (run_id, tenant_id) references identity_reconciliation_runs (id, tenant_id) on delete set null (run_id),
  foreign key (resolved_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (resolved_identity_id)
);
create unique index pending_identity_correlations_open_key
  on pending_identity_correlations (source_id, external_id) where status = 'pending';
create index pending_identity_correlations_tenant_status_idx on pending_identity_correlations (tenant_id, status, created_at desc);
create index pending_identity_correlations_source_fk_idx on pending_identity_correlations (source_id, tenant_id);
create index pending_identity_correlations_run_fk_idx on pending_identity_correlations (run_id, tenant_id);
create index pending_identity_correlations_resolved_fk_idx on pending_identity_correlations (resolved_identity_id, tenant_id);
create index pending_identity_correlations_resolved_by_idx on pending_identity_correlations (resolved_by);

alter table pending_identity_correlations enable row level security;
create policy pending_identity_correlations_select on pending_identity_correlations
  for select using (tenant_id in (select current_tenant_ids()));
