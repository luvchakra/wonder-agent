-- Access Agent — ACCESS-P0-02.1 (higher bar)
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.

create table policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  policy_category text not null check (policy_category in ('identity', 'access', 'runtime', 'agent', 'lifecycle')),
  scope jsonb not null default '{}'::jsonb,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  action text not null check (action in ('flag', 'restrict', 'block')),
  exception_process text,
  owner_id uuid references users(id),
  effective_date timestamptz not null default now(),
  expiry_date timestamptz,
  status text not null default 'active' check (status in ('draft', 'active', 'disabled'))
);

create table policy_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id) on delete cascade,
  rule_type text not null check (rule_type in ('rbac', 'abac', 'resource', 'time')),
  condition jsonb not null,
  created_at timestamptz not null default now()
);

create table policy_exceptions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  reason text not null,
  approved_by uuid not null references users(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index policies_tenant_id_idx on policies (tenant_id);
create index policy_rules_policy_id_idx on policy_rules (policy_id);
create index policy_exceptions_policy_id_idx on policy_exceptions (policy_id);
create index policy_exceptions_agent_id_idx on policy_exceptions (agent_id);

alter table policies enable row level security;
alter table policy_rules enable row level security;
alter table policy_exceptions enable row level security;

-- policies: admin-configured business data (like Foundation's `roles`),
-- ordinary tenant-scoped client RLS; policy.create/policy.update
-- (Foundation's existing permission catalog — already covers this table
-- exactly) checked in the API route.
create policy policies_select on policies
  for select using (tenant_id in (select current_tenant_ids()));
create policy policies_insert on policies
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy policies_update on policies
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

-- policy_rules/policy_exceptions have no tenant_id column of their own (per
-- their schema above) — isolation via a join to policies.tenant_id, same
-- pattern as Integration's integration_mappings.
create policy policy_rules_select on policy_rules
  for select using (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())));
create policy policy_rules_insert on policy_rules
  for insert with check (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())));
create policy policy_rules_update on policy_rules
  for update
  using (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())))
  with check (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())));
create policy policy_rules_delete on policy_rules
  for delete using (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())));

create policy policy_exceptions_select on policy_exceptions
  for select using (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())));
create policy policy_exceptions_insert on policy_exceptions
  for insert with check (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())));
