-- Identity Agent — IDENTITY-P0-02.1
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.

create table agent_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  from_state text,
  to_state text not null,
  reason text not null,
  actor_id uuid,
  actor_type text not null check (actor_type in ('user', 'system')),
  created_at timestamptz not null default now()
);

create index agent_lifecycle_events_agent_id_idx on agent_lifecycle_events (agent_id, created_at desc);

alter table agent_lifecycle_events enable row level security;

-- Unlike agents/agent_identities/agent_owners, this table has NO client
-- INSERT/UPDATE policy at all. It is the audited transition history the
-- product's critical acceptance test depends on
-- (docs/plan/02-IDENTITY-AGENT-BACKLOG.md IDENTITY-P0-02.1): the set of valid
-- transitions is a business rule enforced by transitionAgentLifecycle()
-- (modules/agent-identity/service.ts), not something RLS's tenant-match
-- check alone can validate. If a client-facing INSERT policy existed, a
-- tenant user could call the Supabase REST API directly (using their own
-- valid session) and forge an arbitrary transition, bypassing the allowed-
-- transition table entirely. Writes therefore go through the service-role
-- client only, after transitionAgentLifecycle()'s own validation and
-- requirePermission() check — the same treatment Foundation gave audit_logs.
create policy agent_lifecycle_events_select on agent_lifecycle_events
  for select
  using (tenant_id in (select current_tenant_ids()));
