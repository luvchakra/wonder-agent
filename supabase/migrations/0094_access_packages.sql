-- ACCESS-P0-20 (WonderID Phase 4, 2026-09-26) — access packages (spec §12):
-- bundles of governed access with an owner and a policy, requested through
-- the request catalog and approved by the approval engine (ACCESS-P0-18/19),
-- assigned as one unit, and revoked as one unit when they expire.
--
-- 1. access_packages: name, description, owner (an identity), status
--    (draft / active / retired), and its policy: who may discover and
--    request it (identity types, departments), the approval route, mode and
--    timeout, the longest and default duration, whether it may be extended,
--    and how often assignments are certified.
-- 2. access_package_resources: what a package includes — an application's
--    access, or one of its entitlements.
-- 3. access_requests may name a package instead of an application
--    (application_id becomes nullable; a request names one or the other),
--    with one waiting request per person and package.
-- 4. access_package_assignments: who holds a package, from a request or a
--    direct assignment by an access manager, until when, and its state
--    (provisioning, active, partially failed, expired, revoked); one live
--    assignment per identity and package.
-- 5. access_package_assignment_items: one work item per included resource
--    — pending, fulfilled or failed on the way in; revoke-pending and
--    revoked on the way out. Fulfilment in the target system is the
--    provisioning pipeline's (INTEGRATION-P0-13); until then a person
--    records it. Expiry and revocation turn fulfilled items into
--    revocation work.
-- 6. access_request_approvals may ask the package owner.
--
-- RLS: members read; the service writes every table here (service role,
-- tenant-filtered) after its permission check, and audits.

create table access_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  owner_identity_id uuid,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  requestable boolean not null default true,
  eligible_identity_types text[] not null default array['HUMAN']::text[]
    check (cardinality(eligible_identity_types) >= 1 and eligible_identity_types <@ array['HUMAN', 'EXTERNAL', 'MACHINE', 'AI_AGENT']::text[]),
  -- Empty: every department.
  eligible_departments text[] not null default array[]::text[],
  approval text not null default 'manager_and_owner' check (approval in ('manager_approval', 'owner_approval', 'manager_and_owner')),
  approval_mode text not null default 'sequential' check (approval_mode in ('sequential', 'parallel')),
  approval_timeout_days integer not null default 5 check (approval_timeout_days between 1 and 60),
  on_timeout text not null default 'escalate' check (on_timeout in ('escalate', 'expire')),
  max_duration_days integer check (max_duration_days is null or max_duration_days between 1 and 3650),
  default_duration_days integer check (default_duration_days is null or default_duration_days between 1 and 3650),
  extension_allowed boolean not null default false,
  certification_frequency text not null default 'annual' check (certification_frequency in ('none', 'quarterly', 'semiannual', 'annual')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, name),
  check (default_duration_days is null or max_duration_days is null or default_duration_days <= max_duration_days),
  foreign key (owner_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (owner_identity_id)
);
create index access_packages_owner_idx on access_packages (owner_identity_id, tenant_id);
create index access_packages_created_by_idx on access_packages (created_by);
create index access_packages_tenant_status_idx on access_packages (tenant_id, status, name);

create table access_package_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  package_id uuid not null,
  application_id uuid not null,
  entitlement_id uuid,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (package_id, tenant_id) references access_packages (id, tenant_id) on delete cascade,
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  foreign key (entitlement_id, tenant_id) references entitlements (id, tenant_id) on delete cascade
);
create unique index access_package_resources_key on access_package_resources (
  package_id, application_id, coalesce(entitlement_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index access_package_resources_package_idx on access_package_resources (package_id, tenant_id);
create index access_package_resources_app_idx on access_package_resources (application_id, tenant_id);
create index access_package_resources_ent_idx on access_package_resources (entitlement_id, tenant_id);

-- A request names an application (and perhaps an entitlement) or a package.
alter table access_requests alter column application_id drop not null;
alter table access_requests
  add column access_package_id uuid,
  add constraint access_requests_package_fkey foreign key (access_package_id, tenant_id) references access_packages (id, tenant_id),
  add constraint access_requests_item_check check ((application_id is null) <> (access_package_id is null));
create index access_requests_package_idx on access_requests (access_package_id, tenant_id);
create unique index access_requests_one_pending_package_key on access_requests (tenant_id, subject_identity_id, access_package_id)
  where status = 'pending' and access_package_id is not null;

create table access_package_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  package_id uuid not null,
  identity_id uuid not null,
  request_id uuid,
  source text not null check (source in ('request', 'direct')),
  status text not null default 'provisioning' check (status in ('provisioning', 'active', 'partially_failed', 'expired', 'revoked')),
  justification text check (justification is null or char_length(justification) <= 2000),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  assigned_by uuid references users(id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references users(id) on delete set null,
  end_reason text check (end_reason is null or char_length(end_reason) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  -- A direct assignment has no request; a requested one keeps its request (unless that is deleted).
  check (source = 'request' or request_id is null),
  check ((status in ('expired', 'revoked')) = (ended_at is not null)),
  foreign key (package_id, tenant_id) references access_packages (id, tenant_id),
  foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  foreign key (request_id, tenant_id) references access_requests (id, tenant_id) on delete set null (request_id)
);
-- One live assignment per identity and package.
create unique index access_package_assignments_live_key on access_package_assignments (tenant_id, package_id, identity_id)
  where status in ('provisioning', 'active', 'partially_failed');
-- One assignment per request, so an approval never assigns twice.
create unique index access_package_assignments_request_key on access_package_assignments (request_id) where request_id is not null;
create index access_package_assignments_package_idx on access_package_assignments (package_id, tenant_id);
create index access_package_assignments_identity_idx on access_package_assignments (identity_id, tenant_id);
create index access_package_assignments_request_idx on access_package_assignments (request_id, tenant_id);
create index access_package_assignments_expiry_idx on access_package_assignments (tenant_id, expires_at)
  where status in ('provisioning', 'active', 'partially_failed');
create index access_package_assignments_assigned_by_idx on access_package_assignments (assigned_by);
create index access_package_assignments_ended_by_idx on access_package_assignments (ended_by);

create table access_package_assignment_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  assignment_id uuid not null,
  application_id uuid not null,
  entitlement_id uuid,
  status text not null default 'pending' check (status in ('pending', 'fulfilled', 'failed', 'revoke_pending', 'revoked')),
  detail text check (detail is null or char_length(detail) <= 1000),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (assignment_id, tenant_id) references access_package_assignments (id, tenant_id) on delete cascade,
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  foreign key (entitlement_id, tenant_id) references entitlements (id, tenant_id) on delete cascade
);
create index access_package_assignment_items_assignment_idx on access_package_assignment_items (assignment_id, tenant_id);
create index access_package_assignment_items_app_idx on access_package_assignment_items (application_id, tenant_id);
create index access_package_assignment_items_ent_idx on access_package_assignment_items (entitlement_id, tenant_id);
create index access_package_assignment_items_work_idx on access_package_assignment_items (tenant_id, status)
  where status in ('pending', 'failed', 'revoke_pending');
create index access_package_assignment_items_updated_by_idx on access_package_assignment_items (updated_by);

alter table access_packages enable row level security;
alter table access_package_resources enable row level security;
alter table access_package_assignments enable row level security;
alter table access_package_assignment_items enable row level security;
create policy access_packages_select on access_packages for select using (tenant_id in (select current_tenant_ids()));
create policy access_package_resources_select on access_package_resources for select using (tenant_id in (select current_tenant_ids()));
create policy access_package_assignments_select on access_package_assignments for select using (tenant_id in (select current_tenant_ids()));
create policy access_package_assignment_items_select on access_package_assignment_items for select using (tenant_id in (select current_tenant_ids()));

-- The approval engine may ask a package's owner.
alter table access_request_approvals drop constraint access_request_approvals_approver_kind_check;
alter table access_request_approvals add constraint access_request_approvals_approver_kind_check
  check (approver_kind in ('manager', 'entitlement_owner', 'application_owner', 'package_owner', 'access_managers'));
