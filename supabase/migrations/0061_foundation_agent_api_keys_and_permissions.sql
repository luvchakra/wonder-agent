-- Foundation Agent — FOUNDATION-P0-17 (agent API keys) and FOUNDATION-P0-18
-- (new permission keys), from the 2026-09-25 master P0/P1/P2 stories.
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.
--
-- User decisions, 2026-09-25: agents authenticate to the Runtime Gateway
-- with per-agent API keys; only the permission keys the master list adds
-- are created, and none of the existing keys is renamed.

-- ---------------------------------------------------------------------------
-- FOUNDATION-P0-18 — permission keys
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('agent.suspend', 'Suspend or restrict an AI agent'),
  ('discovery.read', 'View discovered agents, identities and shadow AI'),
  ('discovery.manage', 'Register, link or dismiss discovered agents and identities'),
  ('access.simulate', 'Run access and policy simulations (never changes production access)'),
  ('policy.publish', 'Publish a policy version so it takes effect'),
  ('runtime.enforce', 'Change a runtime gateway''s mode between observe-only and enforce'),
  ('runtime.emergency', 'Use emergency controls: kill switch, credential revocation, session termination')
on conflict (key) do nothing;

-- 0003's cross-join grants only covered permissions that existed then, so
-- every new key is granted explicitly, by least privilege.

-- TENANT_SUPER_ADMIN: all of them.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
  and p.key in ('agent.suspend', 'discovery.read', 'discovery.manage', 'access.simulate',
                'policy.publish', 'runtime.enforce', 'runtime.emergency')
on conflict do nothing;

-- READ_ONLY / AUDITOR: the read key only (same "every *.read" rule as 0003).
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('READ_ONLY', 'AUDITOR') and p.key = 'discovery.read'
on conflict do nothing;

-- IAM_ADMIN operates identities: discovery, suspension, simulation.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ADMIN'
  and p.key in ('agent.suspend', 'discovery.read', 'discovery.manage', 'access.simulate')
on conflict do nothing;

-- IAM_ARCHITECT configures: policies, simulation, gateway mode.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ARCHITECT'
  and p.key in ('discovery.read', 'access.simulate', 'policy.publish', 'runtime.enforce')
on conflict do nothing;

-- SECURITY_ADMIN responds: suspension and emergency controls, policy publish.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'SECURITY_ADMIN'
  and p.key in ('agent.suspend', 'discovery.read', 'access.simulate', 'policy.publish',
                'runtime.enforce', 'runtime.emergency')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- FOUNDATION-P0-17 — agent API keys
-- ---------------------------------------------------------------------------
--
-- A key is shown to the operator exactly once, at creation. Only its
-- SHA-256 hash is stored, and a short non-secret prefix for display. Each
-- key is bound to exactly one tenant and one agent: the Runtime Gateway
-- takes the tenant and agent from the key, never from the request body
-- (non-negotiable #2).
--
-- Same lockdown as integration_credentials (0021) and
-- platform_ai_provider_configs (0057): RLS enabled and **no** client-facing
-- policies, so no browser session can read even the hashes. Every read and
-- write goes through lib/security/agentApiKeys.ts's service-role functions,
-- which check tenant_id visibly on every row (CLAUDE.md §14) behind
-- requirePermission().

create table agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references users(id),
  revoked_reason text
);

alter table agent_api_keys enable row level security;

-- Lookups: by hash (unique index above) on every gateway call; by
-- tenant+agent for the key list; foreign keys indexed per CLAUDE.md §15.
create index agent_api_keys_tenant_agent_idx on agent_api_keys (tenant_id, agent_id, created_at desc);
create index agent_api_keys_agent_idx on agent_api_keys (agent_id);
create index agent_api_keys_created_by_idx on agent_api_keys (created_by);
create index agent_api_keys_revoked_by_idx on agent_api_keys (revoked_by);
