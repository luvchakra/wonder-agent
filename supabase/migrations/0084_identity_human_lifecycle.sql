-- IDENTITY-P0-18 (WonderID Phase 2, 2026-09-26) — the human lifecycle:
-- recorded events (joiner, mover, leaver, rehire, conversion, ...) and
-- the governed work each opens (request baseline access, review access,
-- transfer ownership, revoke access, disable sign-in).
--
-- Events come from identity sources (INTEGRATION-P0-09, via this module's
-- applySourcedIdentities) or from a person's transition on the identity
-- page. A task is a person's job, closed with a note; nothing here grants
-- or revokes access by itself (#15, spec "Lifecycle events must drive
-- governed workflows, not direct uncontrolled writes").
--
-- RLS: members read their tenant's rows; they insert and update them
-- through the service (identity.manage checked there). No delete policy:
-- lifecycle history is evidence.

create table identity_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  identity_id uuid not null,
  event_type text not null check (event_type in
    ('joiner', 'mover', 'leaver', 'rehire', 'conversion', 'manager_change', 'leaver_cancelled', 'disabled', 'terminated', 'archived', 'hire_cancelled')),
  from_state text,
  to_state text,
  changed_fields text[] not null default '{}',
  origin text not null check (origin in ('manual', 'source')),
  -- The identity source and run that reported it (Integration's tables; kept
  -- as plain ids so this module does not depend on theirs).
  source_id uuid,
  run_id uuid,
  actor_id uuid references users(id) on delete set null,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade
);
create index identity_lifecycle_events_identity_idx on identity_lifecycle_events (identity_id, tenant_id, created_at desc);
create index identity_lifecycle_events_tenant_idx on identity_lifecycle_events (tenant_id, created_at desc);
create index identity_lifecycle_events_actor_idx on identity_lifecycle_events (actor_id);

alter table identity_lifecycle_events enable row level security;
create policy identity_lifecycle_events_select on identity_lifecycle_events
  for select using (tenant_id in (select current_tenant_ids()));
create policy identity_lifecycle_events_insert on identity_lifecycle_events
  for insert with check (tenant_id in (select current_tenant_ids()));

create table identity_lifecycle_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_id uuid not null,
  identity_id uuid not null,
  task_type text not null check (task_type in
    ('request_baseline_access', 'review_access', 'transfer_ownership', 'revoke_access', 'disable_sign_in')),
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  assignee_identity_id uuid,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  completed_by uuid references users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (completed_at is null)),
  check (status <> 'skipped' or resolution_note is not null),
  foreign key (event_id, tenant_id) references identity_lifecycle_events (id, tenant_id) on delete cascade,
  foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  foreign key (assignee_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (assignee_identity_id)
);
create index identity_lifecycle_tasks_tenant_status_idx on identity_lifecycle_tasks (tenant_id, status, created_at desc);
create index identity_lifecycle_tasks_identity_idx on identity_lifecycle_tasks (identity_id, tenant_id);
create index identity_lifecycle_tasks_event_idx on identity_lifecycle_tasks (event_id, tenant_id);
create index identity_lifecycle_tasks_assignee_idx on identity_lifecycle_tasks (assignee_identity_id, tenant_id);
create index identity_lifecycle_tasks_completed_by_idx on identity_lifecycle_tasks (completed_by);

alter table identity_lifecycle_tasks enable row level security;
create policy identity_lifecycle_tasks_select on identity_lifecycle_tasks
  for select using (tenant_id in (select current_tenant_ids()));
create policy identity_lifecycle_tasks_insert on identity_lifecycle_tasks
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy identity_lifecycle_tasks_update on identity_lifecycle_tasks
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
