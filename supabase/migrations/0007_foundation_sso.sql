-- Foundation Agent — FOUNDATION-P0-03.3
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.

create table sso_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  protocol text not null check (protocol in ('saml', 'oidc')),
  domain text not null,
  idp_metadata jsonb not null,
  default_role text not null default 'READ_ONLY',
  claims_mapping jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  unique (domain)
);

alter table sso_connections enable row level security;

create policy sso_connections_select on sso_connections
  for select
  using (tenant_id in (select current_tenant_ids()));

-- No client INSERT/UPDATE/DELETE policy: configuring SSO requires
-- sso.manage, enforced server-side (requirePermission('sso.manage')) via the
-- service-role client, never a direct client-side mutation.
