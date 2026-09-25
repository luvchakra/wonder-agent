-- QA-P0-17 (codebase-map D10, 2026-09-25) — same-tenant references for the
-- Access, Integration and Compliance tables. Follows Identity's 0075.
--
-- These foreign keys named a parent by id alone. RLS checks only the new
-- row's own tenant_id, and a foreign key is checked without RLS. So a row
-- stamped with the active tenant could point at a parent in another
-- tenant: through the RLS client, one of the caller's other organizations
-- (where their role was never checked); through a service-role write
-- (control_mappings), any tenant at all. No such rows exist (checked
-- before applying).
--
-- Each key becomes a composite (col, tenant_id) key to the parent's
-- (id, tenant_id), under the SAME constraint name and with the SAME
-- ON DELETE behaviour. Keeping the names keeps every PostgREST embed and
-- `!constraint` hint resolving exactly as before (see 0073/0074).
-- Nullable columns stay optional: MATCH SIMPLE skips the check when the
-- referencing id is null.
--
-- Owning modules: accounts, entitlements, access_grants, access_requests,
-- policies, policy_exceptions (Access); integrations, integration_sync_jobs
-- (Integration); control_mappings (Compliance). Recorded in each audit log.

alter table accounts add constraint accounts_id_tenant_key unique (id, tenant_id);
alter table entitlements add constraint entitlements_id_tenant_key unique (id, tenant_id);
alter table policies add constraint policies_id_tenant_key unique (id, tenant_id);
alter table integrations add constraint integrations_id_tenant_key unique (id, tenant_id);

alter table accounts drop constraint accounts_agent_id_fkey;
alter table accounts add constraint accounts_agent_id_fkey
  foreign key (agent_id, tenant_id) references agents (id, tenant_id) on delete cascade;
alter table accounts drop constraint accounts_application_id_fkey;
alter table accounts add constraint accounts_application_id_fkey
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade;

alter table entitlements drop constraint entitlements_application_id_fkey;
alter table entitlements add constraint entitlements_application_id_fkey
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade;

alter table access_grants drop constraint access_grants_account_id_fkey;
alter table access_grants add constraint access_grants_account_id_fkey
  foreign key (account_id, tenant_id) references accounts (id, tenant_id) on delete cascade;
alter table access_grants drop constraint access_grants_entitlement_id_fkey;
alter table access_grants add constraint access_grants_entitlement_id_fkey
  foreign key (entitlement_id, tenant_id) references entitlements (id, tenant_id) on delete cascade;

alter table access_requests drop constraint access_requests_agent_id_fkey;
alter table access_requests add constraint access_requests_agent_id_fkey
  foreign key (agent_id, tenant_id) references agents (id, tenant_id) on delete cascade;
alter table access_requests drop constraint access_requests_application_id_fkey;
alter table access_requests add constraint access_requests_application_id_fkey
  foreign key (application_id, tenant_id) references applications (id, tenant_id);
alter table access_requests drop constraint access_requests_entitlement_id_fkey;
alter table access_requests add constraint access_requests_entitlement_id_fkey
  foreign key (entitlement_id, tenant_id) references entitlements (id, tenant_id);

alter table policy_exceptions drop constraint policy_exceptions_policy_id_fkey;
alter table policy_exceptions add constraint policy_exceptions_policy_id_fkey
  foreign key (policy_id, tenant_id) references policies (id, tenant_id) on delete cascade;
alter table policy_exceptions drop constraint policy_exceptions_agent_id_fkey;
alter table policy_exceptions add constraint policy_exceptions_agent_id_fkey
  foreign key (agent_id, tenant_id) references agents (id, tenant_id) on delete cascade;

alter table control_mappings drop constraint control_mappings_policy_id_fkey;
alter table control_mappings add constraint control_mappings_policy_id_fkey
  foreign key (policy_id, tenant_id) references policies (id, tenant_id);

alter table integration_sync_jobs drop constraint integration_sync_jobs_integration_id_fkey;
alter table integration_sync_jobs add constraint integration_sync_jobs_integration_id_fkey
  foreign key (integration_id, tenant_id) references integrations (id, tenant_id) on delete cascade;
