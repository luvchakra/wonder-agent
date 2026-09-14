-- Integration Agent — INTEGRATION-P0-01.1
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.

create table integration_types (
  id text primary key,
  display_name text not null,
  category text not null check (category in (
    'iam_iga', 'pam', 'cloud', 'ai_runtime', 'mcp', 'siem', 'ticketing', 'custom_api'
  )),
  default_capabilities jsonb not null default '{}'::jsonb
);

-- Catalog data, not tenant-scoped: readable by any authenticated user, no
-- client-facing mutation (the P0 catalog below is fixed; adding a new
-- connector type is a code change, not a runtime configuration action).
alter table integration_types enable row level security;

create policy integration_types_select_all on integration_types
  for select
  using (true);

insert into integration_types (id, display_name, category, default_capabilities) values
  ('saviynt', 'Saviynt', 'iam_iga', '{"importIdentities":true,"importAccounts":true,"importApplications":true,"importEntitlements":true,"importAccess":true,"importPolicies":true,"importActivity":false,"provision":false,"deprovision":false}'::jsonb),
  ('generic_rest', 'Generic REST', 'custom_api', '{"importIdentities":true,"importAccounts":true,"importApplications":true,"importEntitlements":true,"importAccess":true,"importActivity":false,"provision":false,"deprovision":false}'::jsonb),
  ('mcp', 'MCP Server', 'mcp', '{"importActivity":true,"provision":false,"deprovision":false}'::jsonb),
  ('webhook', 'Webhook', 'custom_api', '{"importActivity":true,"provision":false,"deprovision":false}'::jsonb);
