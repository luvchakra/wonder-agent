-- ACCESS-P0-35 part 1 (design §5.3, owner decision 2026-10-14): approved
-- changes to governance objects, starting with request policies.
--
-- In an organization with two or more active Tenant Administrators, a
-- change to a request policy is proposed, not applied: it waits here with
-- what it would change, and someone other than the proposer who manages
-- access approves (it is then applied) or rejects it. With one
-- administrator a change applies at once, as before. Either way each
-- applied change is kept as a numbered version.
--
-- Generic on purpose: roles, SoD rules, lifecycle rules and workflows join
-- by adding their object_type. Members who manage access read both
-- tables; the Access service writes.

create table governance_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  object_type text not null check (object_type in ('request_policy')),
  -- null when the change creates the object
  object_id uuid,
  -- what identifies the object before it exists (a request policy's application and entitlement)
  object_key jsonb not null default '{}',
  -- the object's version when proposed; approval refuses a change made stale by another
  base_version integer,
  previous jsonb,
  proposed jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid not null references users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  check (decided_by is null or decided_by <> requested_by),
  check ((status = 'pending') = (decided_at is null))
);

-- One waiting change per object.
create unique index governance_changes_one_pending on governance_changes (tenant_id, object_type, (object_key::text)) where status = 'pending';
create index governance_changes_tenant_status_idx on governance_changes (tenant_id, status, requested_at desc);
create index governance_changes_requested_by_idx on governance_changes (requested_by);
create index governance_changes_decided_by_idx on governance_changes (decided_by) where decided_by is not null;

alter table governance_changes enable row level security;
create policy governance_changes_select on governance_changes for select
  using (tenant_id in (select current_tenant_ids()) and has_tenant_permission(tenant_id, 'access.manage'));

create table governance_object_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  object_type text not null check (object_type in ('request_policy')),
  object_id uuid not null,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  change_id uuid references governance_changes(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  approved_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, object_type, object_id, version)
);

create index governance_object_versions_change_idx on governance_object_versions (change_id) where change_id is not null;
create index governance_object_versions_created_by_idx on governance_object_versions (created_by) where created_by is not null;
create index governance_object_versions_approved_by_idx on governance_object_versions (approved_by) where approved_by is not null;

alter table governance_object_versions enable row level security;
create policy governance_object_versions_select on governance_object_versions for select
  using (tenant_id in (select current_tenant_ids()) and has_tenant_permission(tenant_id, 'access.manage'));

alter table access_request_policies
  add column version integer not null default 1;
