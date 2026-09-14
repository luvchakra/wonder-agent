-- Access Agent — ACCESS-P0-01.1 / ACCESS-P0-01.2 (higher bar)
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  name text not null,
  data_classification text,
  privilege_level text not null default 'standard' check (privilege_level in ('standard', 'elevated', 'admin')),
  created_at timestamptz not null default now()
);

create table access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  entitlement_id uuid not null references entitlements(id) on delete cascade,
  grant_type text not null check (grant_type in (
    'direct', 'inherited', 'group', 'role', 'delegated', 'token_scope',
    'oauth_scope', 'api_scope', 'mcp_tool_permission', 'service_account_relationship'
  )),
  source_integration_id uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index entitlements_tenant_id_idx on entitlements (tenant_id);
create index entitlements_application_id_idx on entitlements (application_id);
create index access_grants_tenant_id_idx on access_grants (tenant_id);
create index access_grants_account_id_idx on access_grants (account_id);
create index access_grants_entitlement_id_idx on access_grants (entitlement_id);

alter table entitlements enable row level security;
alter table access_grants enable row level security;

create policy entitlements_select on entitlements
  for select using (tenant_id in (select current_tenant_ids()));
create policy entitlements_insert on entitlements
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy entitlements_update on entitlements
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

-- access_grants is the CAN evidence Risk Agent's core security judgment
-- (SHOULD vs CAN vs DID) depends on — the same integrity reasoning Identity
-- applied to agent_lifecycle_events/agent_contracts (see their migration
-- comments): a client-facing INSERT/UPDATE policy would let a tenant member
-- fabricate or hide effective access directly via the Supabase REST API,
-- bypassing this module's own logic entirely. No client write policy at
-- all — only modules/access-governance/grants.ts (via
-- supabaseServiceRole(), after its own tenant/ownership checks and
-- requirePermission('access.manage')/('access.approve')) may write here.
create policy access_grants_select on access_grants
  for select using (tenant_id in (select current_tenant_ids()));
