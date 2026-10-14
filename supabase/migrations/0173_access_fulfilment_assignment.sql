-- ACCESS-P0-42 (owner request 2026-10-14): internal fulfilment task
-- assignment, ahead of ticketing (INTEGRATION-P0-26).
--
-- application_fulfilment_assignments: who does an application's manual
-- fulfilment tasks. One row for the application (entitlement_type null),
-- and optionally one per entitlement type, each naming a person (an
-- identity) or a group (Foundation's groups, whose members are users). A
-- task with no matching row keeps today's route: the technical owner, then
-- the business owner, then the access managers.
--
-- access_fulfilment_tasks gains:
-- - assignee_group_id: the group whose members may claim the task;
-- - assigned_by, assigned_at, assignment_reason: who last reassigned it,
--   when and why (the audit log keeps every reassignment).
-- A task is assigned to a person or a group, never both.
--
-- Members read; the Access service writes.

create table application_fulfilment_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  application_id uuid not null,
  entitlement_type text check (entitlement_type is null or char_length(entitlement_type) between 1 and 100),
  assignee_identity_id uuid,
  assignee_group_id uuid,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  foreign key (assignee_identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  foreign key (assignee_group_id, tenant_id) references groups (id, tenant_id) on delete cascade,
  check ((assignee_identity_id is null) <> (assignee_group_id is null))
);

create unique index application_fulfilment_assignments_key on application_fulfilment_assignments (tenant_id, application_id, coalesce(lower(entitlement_type), ''));
create index application_fulfilment_assignments_application_idx on application_fulfilment_assignments (application_id);
create index application_fulfilment_assignments_identity_idx on application_fulfilment_assignments (assignee_identity_id) where assignee_identity_id is not null;
create index application_fulfilment_assignments_group_idx on application_fulfilment_assignments (assignee_group_id) where assignee_group_id is not null;
create index application_fulfilment_assignments_created_by_idx on application_fulfilment_assignments (created_by) where created_by is not null;
create index application_fulfilment_assignments_updated_by_idx on application_fulfilment_assignments (updated_by) where updated_by is not null;

alter table application_fulfilment_assignments enable row level security;
create policy application_fulfilment_assignments_select on application_fulfilment_assignments for select using (tenant_id in (select current_tenant_ids()));

alter table access_fulfilment_tasks
  add column assignee_group_id uuid,
  add column assigned_by uuid references users(id) on delete set null,
  add column assigned_at timestamptz,
  add column assignment_reason text check (assignment_reason is null or char_length(assignment_reason) <= 2000),
  add constraint access_fulfilment_tasks_group_fkey foreign key (assignee_group_id, tenant_id) references groups (id, tenant_id) on delete set null (assignee_group_id),
  add constraint access_fulfilment_tasks_one_assignee check (assignee_identity_id is null or assignee_group_id is null);

create index access_fulfilment_tasks_group_idx on access_fulfilment_tasks (tenant_id, assignee_group_id) where assignee_group_id is not null;
create index access_fulfilment_tasks_assigned_by_idx on access_fulfilment_tasks (assigned_by) where assigned_by is not null;
