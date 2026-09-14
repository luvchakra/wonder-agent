-- Identity Agent — IDENTITY-P0-04
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.
--
-- Evidentiary/computed data (like risk_findings/certification_decisions):
-- client SELECT only, all writes via supabaseServiceRole() from
-- modules/agent-identity/duplicates.ts, after requirePermission('agent.create').

create table agent_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  matched_agent_id uuid not null references agents(id) on delete cascade,
  candidate_data jsonb not null,
  match_score numeric not null,
  matched_keys text[] not null,
  status text not null default 'pending' check (status in ('pending', 'merged', 'confirmed_distinct')),
  created_by uuid references users(id),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index on agent_duplicate_candidates (tenant_id, status);

alter table agent_duplicate_candidates enable row level security;

create policy agent_duplicate_candidates_select on agent_duplicate_candidates
  for select
  using (tenant_id in (select current_tenant_ids()));

-- No insert/update/delete policy for authenticated: all writes go through
-- supabaseServiceRole() in modules/agent-identity/duplicates.ts, which
-- manually verifies tenant_id before mutating (CLAUDE.md §14).
