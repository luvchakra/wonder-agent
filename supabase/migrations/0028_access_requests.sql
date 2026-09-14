-- Access Agent — ACCESS-P0-01.3
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.
--
-- Extends Foundation's permission catalog with the access.* keys this
-- module's stories require (Foundation's own migration comment invites
-- exactly this: "grow this list as other modules need new permissions").
-- This inserts new catalog rows into Foundation-owned tables
-- (permissions, role_permissions) rather than altering any existing
-- Foundation migration file or changing Foundation's schema — per
-- ACCESS-P0-01.3's explicit instruction to add `access.approve` "via a
-- migration note in the audit log." access.read/access.request/access.manage
-- are added alongside it since the same story needs a read permission and a
-- submit permission, and manual CRUD (ACCESS-P0-01.1's fallback path when
-- Integration data isn't available) needs its own manage permission rather
-- than overloading agent.update for access data.

insert into permissions (key, description) values
  ('access.read', 'View effective access, entitlements and access requests'),
  ('access.request', 'Submit an access request'),
  ('access.approve', 'Approve, reject or fulfill an access request'),
  ('access.manage', 'Manually manage applications, accounts, entitlements and access grants')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
  and p.key in ('access.read', 'access.request', 'access.approve', 'access.manage')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ADMIN'
  and p.key in ('access.read', 'access.request', 'access.approve', 'access.manage')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ARCHITECT'
  and p.key in ('access.read', 'access.manage')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'SECURITY_ADMIN'
  and p.key in ('access.read', 'access.approve')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('BUSINESS_OWNER', 'TECHNICAL_OWNER', 'APPLICATION_OWNER')
  and p.key in ('access.read', 'access.request')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name in ('READ_ONLY', 'AUDITOR')
  and p.key = 'access.read'
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'REQUESTER'
  and p.key in ('access.read', 'access.request')
on conflict do nothing;

create table access_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  requested_by uuid not null references users(id),
  application_id uuid not null references applications(id),
  entitlement_id uuid references entitlements(id),
  justification text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'fulfilled')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index access_requests_tenant_id_idx on access_requests (tenant_id);
create index access_requests_agent_id_idx on access_requests (agent_id);

alter table access_requests enable row level security;

create policy access_requests_select on access_requests
  for select using (tenant_id in (select current_tenant_ids()));

-- Same integrity pattern as integration_sync_jobs: a client may create a
-- request, but only in its just-submitted 'pending' state with no decision
-- fields populated — approving/rejecting/fulfilling happens only through
-- modules/access-governance/requests.ts (service-role), gated by
-- requirePermission('access.approve').
create policy access_requests_insert on access_requests
  for insert
  with check (
    tenant_id in (select current_tenant_ids())
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );
