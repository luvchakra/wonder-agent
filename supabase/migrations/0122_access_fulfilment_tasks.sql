-- Access Agent — ACCESS-P0-29: fulfilment tasks.
-- Owner: Access Agent (access_fulfilment_tasks). The notification type is
-- added to Operations' notifications/notification_preferences checks
-- additively (the established pattern of 0085 and 0102).
-- See docs/design/ownership-map.md before modifying.
--
-- An approved request's pending grant (0121) is work for someone: until
-- provisioning exists (F3), a person makes the change on the target. Each
-- pending grant gets one task, assigned to the application's technical
-- owner (else its business owner). A person claims it, completes it with
-- a note (the grant becomes "fulfilled, not yet verified"), or reports it
-- failed with a reason. It is due after the organization's SLA
-- (Global Configuration `access.fulfilmentSlaDays`), is overdue after
-- that with a daily reminder, and is closed as verified when
-- reconciliation finds the grant at the source. Members read their own
-- organization's tasks; only the Access module's service writes them.

-- The same-tenant key below needs (id, tenant_id) to be unique on access_grants.
alter table access_grants add constraint access_grants_id_tenant_key unique (id, tenant_id);

create table access_fulfilment_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  access_grant_id uuid not null,
  request_id uuid,
  application_id uuid not null,
  assignee_identity_id uuid,
  status text not null default 'open' check (status in ('open', 'claimed', 'completed', 'failed', 'verified', 'cancelled')),
  due_at timestamptz not null,
  claimed_by uuid references users (id) on delete set null,
  claimed_at timestamptz,
  completed_by uuid references users (id) on delete set null,
  completed_at timestamptz,
  note text check (note is null or char_length(note) <= 2000),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 2000),
  reminded_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  constraint access_fulfilment_tasks_grant_fkey foreign key (access_grant_id, tenant_id) references access_grants (id, tenant_id) on delete cascade,
  constraint access_fulfilment_tasks_request_fkey foreign key (request_id, tenant_id) references access_requests (id, tenant_id) on delete set null (request_id),
  constraint access_fulfilment_tasks_application_fkey foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  constraint access_fulfilment_tasks_assignee_fkey foreign key (assignee_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (assignee_identity_id),
  -- A failure always says why; a claim always says who.
  constraint access_fulfilment_tasks_failed_check check (status <> 'failed' or failure_reason is not null),
  constraint access_fulfilment_tasks_claimed_check check (status <> 'claimed' or claimed_by is not null)
);

-- One task per grant, so an approval run twice opens one.
create unique index access_fulfilment_tasks_grant_key on access_fulfilment_tasks (access_grant_id);
create index access_fulfilment_tasks_tenant_status_idx on access_fulfilment_tasks (tenant_id, status, due_at);
create index access_fulfilment_tasks_request_fk_idx on access_fulfilment_tasks (request_id, tenant_id) where request_id is not null;
create index access_fulfilment_tasks_application_fk_idx on access_fulfilment_tasks (application_id, tenant_id);
create index access_fulfilment_tasks_assignee_fk_idx on access_fulfilment_tasks (assignee_identity_id, tenant_id) where assignee_identity_id is not null;
create index access_fulfilment_tasks_claimed_by_idx on access_fulfilment_tasks (claimed_by) where claimed_by is not null;
create index access_fulfilment_tasks_completed_by_idx on access_fulfilment_tasks (completed_by) where completed_by is not null;

alter table access_fulfilment_tasks enable row level security;
create policy access_fulfilment_tasks_select on access_fulfilment_tasks
  for select using (tenant_id in (select current_tenant_ids()));

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required', 'lifecycle_task',
  'billing_alert', 'privacy_deadline', 'fulfilment_task'
));
alter table notification_preferences drop constraint notification_preferences_type_check;
alter table notification_preferences add constraint notification_preferences_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required', 'lifecycle_task',
  'billing_alert', 'privacy_deadline', 'fulfilment_task'
));
