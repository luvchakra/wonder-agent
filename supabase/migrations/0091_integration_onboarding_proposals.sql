-- INTEGRATION-P0-12 (WonderID Phase 3, 2026-09-26) — AI-assisted
-- onboarding proposals: from an OpenAPI document or a sample account
-- payload, a schema-validated proposal (account schema, identifier,
-- correlation, entitlements, operations, risk, requestability) with
-- assumptions, confidence, evidence, unresolved questions, destructive
-- actions and suggested tests (spec §8.2).
--
-- A proposal never activates anything: applying one writes an onboarding
-- draft (ACCESS-P0-16), which must still be validated, simulated, approved
-- by someone else and promoted. The pasted input itself is not stored —
-- only its SHA-256 and size — so a sample payload's personal data does not
-- persist here. The provenance of any AI step is kept (§17.7): whether a
-- model was used, which provider, what it chose that was accepted, what
-- was rejected as not present in the input, and any error.
--
-- RLS: members read their tenant's proposals; the service writes them
-- (service role, tenant-filtered) after checking the permission.

create table onboarding_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application_id uuid not null,
  input_kind text not null check (input_kind in ('openapi', 'sample')),
  input_sha256 text not null check (char_length(input_sha256) = 64),
  input_bytes integer not null check (input_bytes > 0),
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
  overall_confidence text not null check (overall_confidence in ('high', 'medium', 'low')),
  ai_used boolean not null default false,
  ai_provider text check (ai_provider is null or char_length(ai_provider) <= 50),
  ai_accepted jsonb not null default '[]'::jsonb,
  ai_rejected jsonb not null default '[]'::jsonb,
  ai_error text check (ai_error is null or char_length(ai_error) <= 500),
  status text not null default 'PROPOSED' check (status in ('PROPOSED', 'APPLIED', 'DISMISSED')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  unique (id, tenant_id),
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade
);
create index onboarding_proposals_app_idx on onboarding_proposals (application_id, tenant_id, created_at desc);
create index onboarding_proposals_tenant_idx on onboarding_proposals (tenant_id, created_at desc);
create index onboarding_proposals_created_by_idx on onboarding_proposals (created_by);
create index onboarding_proposals_decided_by_idx on onboarding_proposals (decided_by);

alter table onboarding_proposals enable row level security;
create policy onboarding_proposals_select on onboarding_proposals
  for select using (tenant_id in (select current_tenant_ids()));
