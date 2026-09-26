-- ACCESS-P0-16 (WonderID Phase 3, 2026-09-26) — application onboarding:
-- Configure → Validate → Simulate → Approve → Promote (spec §8), one
-- record per application.
--
-- The configuration is versioned and hashed. Validation, simulation and
-- approval each record the hash they ran against, so a changed
-- configuration invalidates them (spec §8.6). Promotion copies exactly the
-- approved snapshot and only while the configuration is still that one.
-- Simulation only reads: its results live here, never in production
-- tables. Approval is four-eyes: the approver is not the person who
-- submitted it (checked in the service and here).
--
-- RLS: members read their tenant's rows. There is no insert, update or
-- delete policy: approvals must be tamper-resistant (CLAUDE.md §17.4), so
-- only the service writes, with the service role, after checking
-- access.manage, the stage and four-eyes, and filtering by tenant_id.

create table application_onboardings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application_id uuid not null,
  mode text not null default 'assisted' check (mode in ('quick_start', 'assisted', 'advanced')),
  status text not null default 'DRAFT' check (status in
    ('DRAFT', 'CONFIGURING', 'VALIDATING', 'SIMULATING', 'WAITING_FOR_APPROVAL', 'APPROVED', 'PROMOTED', 'FAILED', 'REJECTED', 'ARCHIVED')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  config_version integer not null default 1 check (config_version >= 1),
  config_hash text not null check (char_length(config_hash) = 64),
  validation_results jsonb,
  validated_hash text,
  validated_at timestamptz,
  simulation_results jsonb,
  simulated_hash text,
  simulated_at timestamptz,
  submitted_by uuid references users(id) on delete set null,
  submitted_at timestamptz,
  approved_hash text,
  approved_config jsonb,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  promoted_config jsonb,
  promoted_hash text,
  promoted_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (application_id),
  -- Four-eyes: whoever approves did not submit.
  check (approved_by is null or submitted_by is null or approved_by <> submitted_by),
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade
);
create index application_onboardings_tenant_status_idx on application_onboardings (tenant_id, status, updated_at desc);
create index application_onboardings_app_fk_idx on application_onboardings (application_id, tenant_id);
create index application_onboardings_submitted_by_idx on application_onboardings (submitted_by);
create index application_onboardings_approved_by_idx on application_onboardings (approved_by);
create index application_onboardings_created_by_idx on application_onboardings (created_by);

alter table application_onboardings enable row level security;
create policy application_onboardings_select on application_onboardings
  for select using (tenant_id in (select current_tenant_ids()));
