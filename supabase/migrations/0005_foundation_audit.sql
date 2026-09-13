-- Foundation Agent — FOUNDATION-P0-05.1
-- Owner: Foundation Agent (schema + writeAudit() utility). Operations Agent
-- owns presentation/search/export over this table — see docs/design/ownership-map.md.

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_id uuid,
  actor_type text not null check (actor_type in ('user', 'system', 'integration')),
  action text not null,
  object_type text not null,
  object_id text not null,
  outcome text not null check (outcome in ('success', 'failure')),
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index audit_logs_tenant_created_idx on audit_logs (tenant_id, created_at desc);

alter table audit_logs enable row level security;

-- Read-only for tenant members. No INSERT policy is granted here on purpose:
-- the only writer is lib/audit/writeAudit.ts, which uses the service-role
-- client (bypasses RLS). Regular authenticated clients can never insert,
-- update, or delete an audit row.
create policy audit_logs_select on audit_logs
  for select
  using (tenant_id in (select current_tenant_ids()));
