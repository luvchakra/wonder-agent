-- ACCESS-P0-33 (design §5.4), part 1: entitlement types per application and
-- the entitlement fields classification rules will set.
--
-- entitlements gains (all additive, existing rows keep today's behaviour):
-- - entitlement_type: the connector's type (group, role, permission,
--   license, scope, tool permission, or the application's own word);
-- - requestable: false keeps it out of requests (default true, as today);
-- - sox_relevant: drives certification scope and evidence retention;
-- - field_provenance: who set owner, privilege, classification, type,
--   requestable or SOX (a person, the source, or a rule with its version).
--
-- application_entitlement_types: per application, per type, how it is
-- offered in a request (one, several, free text, or shown but not
-- requestable), whether it is certifiable, its default and maximum
-- duration, and an optional request policy (the approval route). Types the
-- connector sends are registered as they arrive; a manual application
-- declares its own. Members read; the Access service writes.

alter table entitlements
  add column entitlement_type text check (entitlement_type is null or char_length(entitlement_type) between 1 and 100),
  add column requestable boolean not null default true,
  add column sox_relevant boolean not null default false,
  add column field_provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(field_provenance) = 'object');

create index entitlements_type_idx on entitlements (tenant_id, application_id, entitlement_type) where entitlement_type is not null;

create table application_entitlement_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  request_mode text not null default 'single' check (request_mode in ('single', 'multiple', 'free_text', 'not_requestable')),
  certifiable boolean not null default true,
  default_duration_days integer check (default_duration_days is null or default_duration_days between 1 and 3650),
  max_duration_days integer check (max_duration_days is null or max_duration_days between 1 and 3650),
  request_policy_id uuid,
  origin text not null default 'manual' check (origin in ('manual', 'connector')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  foreign key (request_policy_id, tenant_id) references access_request_policies (id, tenant_id) on delete set null (request_policy_id),
  check (default_duration_days is null or max_duration_days is null or default_duration_days <= max_duration_days)
);

create unique index application_entitlement_types_name_key on application_entitlement_types (tenant_id, application_id, lower(name));
create index application_entitlement_types_application_idx on application_entitlement_types (application_id);
create index application_entitlement_types_request_policy_idx on application_entitlement_types (request_policy_id) where request_policy_id is not null;
create index application_entitlement_types_created_by_idx on application_entitlement_types (created_by) where created_by is not null;
create index application_entitlement_types_updated_by_idx on application_entitlement_types (updated_by) where updated_by is not null;

alter table application_entitlement_types enable row level security;
create policy application_entitlement_types_select on application_entitlement_types for select using (tenant_id in (select current_tenant_ids()));
