-- Access Agent — ACCESS-P0-02.2 (higher bar)
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.

create table policy_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  policy_id uuid not null references policies(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  result text not null check (result in ('pass', 'violation', 'exempted')),
  evidence jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now()
);

create index policy_evaluations_tenant_id_idx on policy_evaluations (tenant_id);
create index policy_evaluations_agent_id_idx on policy_evaluations (agent_id, evaluated_at desc);
create index policy_evaluations_policy_id_idx on policy_evaluations (policy_id);

alter table policy_evaluations enable row level security;

-- Evidence output of the deterministic evaluation engine
-- (modules/access-governance/evaluate.ts) — the same integrity reasoning as
-- access_grants applies: a client must never be able to fabricate a 'pass'
-- result for a policy it actually violates. No client write policy at all.
create policy policy_evaluations_select on policy_evaluations
  for select using (tenant_id in (select current_tenant_ids()));
