-- Runtime Agent — RUNTIME-P0-15, the Runtime Gateway (master stories P0-26,
-- P0-27, P0-33). Owner: Runtime Agent. See docs/design/ownership-map.md.
--
-- User decisions, 2026-09-25:
-- * The gateway lives in this app at /api/gateway/v1.
-- * Agents authenticate with per-agent API keys (FOUNDATION-P0-17).
-- * Access Agent owns the decision (ACCESS-P0-11); Runtime owns the
--   endpoint and these records.
-- * The default mode is OBSERVE_ONLY.
--
-- Each row is the evidence for one authorization request: what was asked,
-- what the deterministic engine decided and why (every evaluated step), in
-- which mode, and whether it was enforced. Rows are immutable. Tenant
-- members can read them through RLS, gated in the app by runtime.read.
-- Nothing on the client can insert, update or delete: only the gateway
-- writes, through the service role, with the tenant taken from the
-- verified key.

create table runtime_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  api_key_id uuid references agent_api_keys(id) on delete set null,
  request_id text not null check (char_length(request_id) between 1 and 200),
  correlation_id text not null,
  action text not null,
  application text,
  resource text,
  tool text,
  data_classification text,
  identity_id uuid references agent_identities(id) on delete set null,
  decision text not null check (decision in ('ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'ALLOW_WITH_RESTRICTIONS')),
  code text not null,
  reason text not null,
  policy_id uuid references policies(id) on delete set null,
  policy_version integer,
  risk_score numeric,
  restrictions jsonb,
  steps jsonb not null default '[]'::jsonb,
  mode text not null check (mode in ('OBSERVE_ONLY', 'ENFORCE')),
  enforced boolean not null,
  created_at timestamptz not null default now(),
  -- Idempotency: the same agent re-sending the same request id gets the
  -- original decision back, never a second record (§17.6).
  unique (tenant_id, agent_id, request_id)
);

alter table runtime_decisions enable row level security;

create policy runtime_decisions_select on runtime_decisions
  for select
  using (tenant_id in (select current_tenant_ids()));

create index runtime_decisions_tenant_time_idx on runtime_decisions (tenant_id, created_at desc);
create index runtime_decisions_tenant_agent_time_idx on runtime_decisions (tenant_id, agent_id, created_at desc);
create index runtime_decisions_agent_idx on runtime_decisions (agent_id);
create index runtime_decisions_api_key_idx on runtime_decisions (api_key_id);
create index runtime_decisions_identity_idx on runtime_decisions (identity_id);
create index runtime_decisions_policy_idx on runtime_decisions (policy_id);
