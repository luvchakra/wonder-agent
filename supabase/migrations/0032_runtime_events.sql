-- Runtime Agent — RUNTIME-P0-01.1 (schema)
-- Owner: Runtime Agent. See docs/design/ownership-map.md before modifying.
--
-- Extends Foundation's permission catalog with the runtime.* keys this
-- module's stories require (same growth pattern Access Agent used for
-- access.* in migration 0028) — new catalog rows only, no change to any
-- existing Foundation migration file.
insert into permissions (key, description) values
  ('runtime.read', 'View runtime activity, DID summaries and SHOULD/CAN/DID comparisons'),
  ('runtime.ingest', 'Submit runtime events into the activity timeline')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
  and p.key in ('runtime.read', 'runtime.ingest')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ADMIN'
  and p.key in ('runtime.read', 'runtime.ingest')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ARCHITECT'
  and p.key in ('runtime.read', 'runtime.ingest')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('SECURITY_ADMIN', 'BUSINESS_OWNER', 'TECHNICAL_OWNER',
  'APPLICATION_OWNER', 'CERTIFICATION_MANAGER', 'READ_ONLY', 'AUDITOR')
  and p.key = 'runtime.read'
on conflict do nothing;

-- Owned entities (docs/plan/05-RUNTIME-AGENT-BACKLOG.md, RUNTIME-P0-01.1).
--
-- runtime_events is evidentiary data the module's central SHOULD/CAN/DID
-- claim depends on — same treatment as access_grants/policy_evaluations/
-- integration_objects: a client-facing SELECT policy (for the timeline
-- screen), but NO client-facing INSERT/UPDATE policy at all. Every event
-- enters only through ingestRuntimeEvent() (service-role), which is also
-- where the idempotency guarantee (RUNTIME-P0-01.2) lives. Allowing a client
-- to insert an event directly would let a tenant forge its own DID evidence,
-- undermining the same central security claim the Access Agent's
-- access_grants lockdown protects.
create table runtime_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  identity_id uuid references agent_identities(id) on delete set null,
  event_time timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('mcp', 'rest', 'webhook')),
  tool text,
  application text,
  resource text,
  action text not null,
  data_classification text,
  success boolean not null,
  raw jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);

create index runtime_events_tenant_agent_time_idx on runtime_events (tenant_id, agent_id, event_time desc);
-- Supports timeline queries that aren't scoped to a single agent
-- (CLAUDE.md §15: index every real query pattern, not only the primary one).
create index runtime_events_tenant_time_idx on runtime_events (tenant_id, event_time desc);

alter table runtime_events enable row level security;

create policy runtime_events_select on runtime_events
  for select using (tenant_id in (select current_tenant_ids()));

-- runtime_tools / runtime_resources: sighting registries derived
-- exclusively from ingested events (RUNTIME-P0-01.2's "on first sight,
-- upsert" requirement) — same integrity reasoning as runtime_events itself,
-- so these also get read-only client access with all writes going through
-- ingestRuntimeEvent()'s service-role upserts.
--
-- Flagged, not silently assumed: the backlog's sketch of runtime_tools
-- doesn't include a unique constraint, but "upsert on first sight, bump
-- last_seen_at" is only implementable atomically against one. Adding
-- `unique (tenant_id, agent_id, name)` here — analogous to the unique
-- constraint the backlog does specify on runtime_resources — is a required,
-- documented completion of the story's own stated behavior, not a new
-- concept. Known limitation: a tool seen with a null agent_id (discovered
-- but not yet correlated to a specific agent) can produce more than one row
-- per tenant/name, since Postgres treats NULL as distinct in unique
-- constraints — acceptable for P0 since every ingested event in this
-- module's scope carries a resolved agent_id.
create table runtime_tools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  name text not null,
  source_integration_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (tenant_id, agent_id, name)
);

create index runtime_tools_tenant_id_idx on runtime_tools (tenant_id);

alter table runtime_tools enable row level security;

create policy runtime_tools_select on runtime_tools
  for select using (tenant_id in (select current_tenant_ids()));

create table runtime_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application text not null,
  resource text not null,
  data_classification text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (tenant_id, application, resource)
);

create index runtime_resources_tenant_id_idx on runtime_resources (tenant_id);

alter table runtime_resources enable row level security;

create policy runtime_resources_select on runtime_resources
  for select using (tenant_id in (select current_tenant_ids()));
