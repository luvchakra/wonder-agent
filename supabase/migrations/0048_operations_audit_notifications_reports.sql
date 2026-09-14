-- Operations Agent — OPERATIONS-P0-01.1, P0-02.1, P0-04.1, P0-05.1 (schema)
-- Owner: Operations Agent. See docs/design/ownership-map.md before modifying.

insert into permissions (key, description) values
  ('audit.read', 'View the tenant audit trail'),
  ('notification.manage', 'Manage own notification preferences')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
  and p.key in ('audit.read', 'notification.manage')
on conflict do nothing;

-- audit.read: the same read-only audit/evidence-facing roles Risk/Compliance
-- already gave their own *.read permission to, per this codebase's convention.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('IAM_ADMIN', 'IAM_ARCHITECT', 'SECURITY_ADMIN', 'AUDITOR', 'CERTIFICATION_MANAGER')
  and p.key = 'audit.read'
on conflict do nothing;

-- notification.manage: every authenticated tenant role manages its own
-- preferences — this permission gates the *feature*, not a privilege tier.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in (
    'IAM_ADMIN', 'IAM_ARCHITECT', 'SECURITY_ADMIN', 'CERTIFICATION_MANAGER',
    'BUSINESS_OWNER', 'TECHNICAL_OWNER', 'APPLICATION_OWNER', 'AUDITOR', 'REQUESTER', 'READ_ONLY'
  )
  and p.key = 'notification.manage'
on conflict do nothing;

-- OPERATIONS-P0-02.1. `user_id = null` means a tenant-wide broadcast (every
-- user with the relevant permission sees it) — same "null = broadcast"
-- convention the story's own schema sketch specifies. notify() (the only
-- writer) uses the service-role client; the client-facing INSERT-less
-- policy below is deliberate, same evidentiary-write reasoning as every
-- other findings-style table in this build. UPDATE is scoped to the row's
-- own user so a user can mark their own notification read, but never
-- another user's or a broadcast row (broadcast read-state is inherently
-- per-user and out of scope for P0 — read_at stays null for those).
create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id),
  type text not null check (type in (
    'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
    'ownership_missing', 'integration_failure', 'lifecycle_expiry'
  )),
  title text not null,
  body text not null,
  reference_type text,
  reference_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_tenant_user_created_idx on notifications (tenant_id, user_id, created_at desc);

alter table notifications enable row level security;

create policy notifications_select on notifications
  for select using (tenant_id in (select current_tenant_ids()) and (user_id is null or user_id = auth.uid()));

create policy notifications_update on notifications
  for update
  using (tenant_id in (select current_tenant_ids()) and user_id = auth.uid())
  with check (tenant_id in (select current_tenant_ids()) and user_id = auth.uid());

-- OPERATIONS-P0-05.1. A direct extension of the notifications domain
-- already owned by Operations Agent here — not yet in the ownership map,
-- added directly (same as every other module's own-owned table this
-- session), since it duplicates no other module's concept. A missing row
-- for a (user, type) pair means "use the default" (both channels on) —
-- the mandatory types in the check above are enforced at the application
-- layer (notify()'s own logic never honors an opt-out for them), not by a
-- separate constraint here, since "mandatory" is about notify()'s behavior,
-- not a value this table can't hold.
create table notification_preferences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in (
    'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
    'ownership_missing', 'integration_failure', 'lifecycle_expiry'
  )),
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, type)
);

alter table notification_preferences enable row level security;

create policy notification_preferences_select on notification_preferences
  for select using (tenant_id in (select current_tenant_ids()) and user_id = auth.uid());
create policy notification_preferences_insert on notification_preferences
  for insert with check (tenant_id in (select current_tenant_ids()) and user_id = auth.uid());
create policy notification_preferences_update on notification_preferences
  for update
  using (tenant_id in (select current_tenant_ids()) and user_id = auth.uid())
  with check (tenant_id in (select current_tenant_ids()) and user_id = auth.uid());

-- OPERATIONS-P0-04.1. Saved/scheduled report *definitions* only — generated
-- output is always computed live at export time (never cached here or
-- anywhere), per the story's own explicit instruction.
create table reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  report_type text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index reports_tenant_id_idx on reports (tenant_id);

alter table reports enable row level security;

create policy reports_select on reports
  for select using (tenant_id in (select current_tenant_ids()));
create policy reports_insert on reports
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy reports_delete on reports
  for delete using (tenant_id in (select current_tenant_ids()));
