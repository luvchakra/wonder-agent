-- Integration Agent — the connector framework.
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.
--
-- User request (2026-10-10): generic connectors any organization can use,
-- built from one framework that WonderID and, later, system integrators use
-- to connect an organization's HR system, identity provider, directory and
-- each application. This is the backlog's INTEG-P2-01/P2-03 (connector
-- catalog and SDK), brought forward by explicit user request.
--
-- 1. One new integration type, `connector`: an integration that runs a
--    connector definition (modules/integrations/framework). Its config
--    holds a validated snapshot of the definition plus the organization's
--    settings, so a later edit to a definition never changes a running
--    integration behind its owner's back.
-- 2. `connector_definitions`: an organization's own definitions (written by
--    its system integrator). Built-in definitions live in code. Versions are
--    immutable: a change is a new version, never an edit.

insert into integration_types (id, display_name, category, default_capabilities) values
  ('connector', 'Connector', 'custom_api',
   '{"importIdentities":true,"importAccounts":true,"importApplications":true,"importEntitlements":true,"importAccess":true,"importActivity":false,"provision":false,"deprovision":false}'::jsonb)
on conflict (id) do nothing;

create table connector_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9-]{1,62}$'),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  name text not null check (char_length(name) between 1 and 80),
  category text not null check (category in ('hr', 'identity_provider', 'directory', 'application', 'database', 'secrets', 'infrastructure', 'other')),
  driver text not null check (driver in ('http', 'ldap', 'sql')),
  manifest jsonb not null check (pg_column_size(manifest) <= 262144),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, key, version)
);

create index connector_definitions_tenant_key_idx on connector_definitions (tenant_id, key, created_at desc);
create index connector_definitions_created_by_idx on connector_definitions (created_by);

alter table connector_definitions enable row level security;

-- Every member of the organization may read its definitions (they hold no
-- secrets); only people who may create integrations may add one.
create policy connector_definitions_select on connector_definitions
  for select using (tenant_id in (select current_tenant_ids()));

create policy connector_definitions_insert on connector_definitions
  for insert with check (
    tenant_id in (select current_tenant_ids())
    and has_tenant_permission(tenant_id, 'integration.create')
  );

-- No update or delete policy: a published version is immutable for every
-- client. The trigger holds the service role to the same rule.
create or replace function connector_definitions_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'connector definition versions are immutable; publish a new version instead'
    using errcode = 'check_violation';
end;
$$;

create trigger connector_definitions_no_update
  before update on connector_definitions
  for each row execute function connector_definitions_immutable();
