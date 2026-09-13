-- Foundation Agent — FOUNDATION-P0-02.3
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.

create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade, -- null = system role template
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, role_id)
);

create index on user_roles (tenant_id, user_id);

-- Permission catalog (P0). Grow this as later modules need new permissions.
insert into permissions (key, description) values
  ('agent.read', 'View AI agents'),
  ('agent.create', 'Register AI agents'),
  ('agent.update', 'Update AI agent identity, ownership, contract or lifecycle'),
  ('agent.delete', 'Delete/retire AI agents'),
  ('agent.certify', 'Participate in agent access certification'),
  ('policy.read', 'View policies'),
  ('policy.create', 'Create policies'),
  ('policy.update', 'Update policies'),
  ('policy.delete', 'Delete policies'),
  ('integration.read', 'View integrations'),
  ('integration.create', 'Create integrations'),
  ('integration.update', 'Update integration configuration'),
  ('integration.execute', 'Trigger integration sync jobs'),
  ('finding.read', 'View risk findings'),
  ('finding.assign', 'Assign risk findings'),
  ('finding.remediate', 'Initiate remediation for risk findings'),
  ('report.read', 'View reports'),
  ('report.export', 'Export reports/audit evidence'),
  ('tenant.settings', 'Manage tenant settings'),
  ('user.manage', 'Manage tenant users'),
  ('role.manage', 'Manage tenant roles'),
  ('sso.manage', 'Manage tenant SSO connections')
on conflict (key) do nothing;

-- System role templates (tenant_id null).
insert into roles (tenant_id, name, description, is_system) values
  (null, 'TENANT_SUPER_ADMIN', 'Owns tenant configuration and security administration', true),
  (null, 'IAM_ADMIN', 'Operates identities, integrations, access and remediation', true),
  (null, 'IAM_ARCHITECT', 'Configures integrations, identity models, policies and technical mappings', true),
  (null, 'SECURITY_ADMIN', 'Views enterprise risk, rogue agents, posture and compliance', true),
  (null, 'CERTIFICATION_MANAGER', 'Runs and manages agent access certification campaigns', true),
  (null, 'BUSINESS_OWNER', 'Owns AI-agent purpose and business accountability', true),
  (null, 'TECHNICAL_OWNER', 'Owns agent implementation/runtime', true),
  (null, 'APPLICATION_OWNER', 'Reviews agent access to owned applications', true),
  (null, 'AUDITOR', 'Read-only evidence, controls, certifications and audit trails', true),
  (null, 'REQUESTER', 'Can submit agent onboarding/access requests where permitted', true),
  (null, 'READ_ONLY', 'Read-only access', true)
on conflict (tenant_id, name) do nothing;

-- TENANT_SUPER_ADMIN: every permission.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
on conflict do nothing;

-- READ_ONLY / AUDITOR: every *.read permission, plus report.export for AUDITOR.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name in ('READ_ONLY', 'AUDITOR')
  and (p.key like '%.read')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name = 'AUDITOR' and p.key = 'report.export'
on conflict do nothing;

-- IAM_ADMIN: full identity/access/integration/finding operational control.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ADMIN'
  and p.key in (
    'agent.read', 'agent.create', 'agent.update', 'agent.certify',
    'policy.read',
    'integration.read', 'integration.create', 'integration.update', 'integration.execute',
    'finding.read', 'finding.assign', 'finding.remediate',
    'report.read', 'report.export'
  )
on conflict do nothing;

-- IAM_ARCHITECT: configuration-focused (integrations, policies), not remediation.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ARCHITECT'
  and p.key in (
    'agent.read', 'agent.update',
    'policy.read', 'policy.create', 'policy.update',
    'integration.read', 'integration.create', 'integration.update',
    'report.read'
  )
on conflict do nothing;

-- SECURITY_ADMIN: risk/policy/finding visibility and remediation.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name = 'SECURITY_ADMIN'
  and p.key in (
    'agent.read',
    'policy.read', 'policy.create', 'policy.update',
    'finding.read', 'finding.assign', 'finding.remediate',
    'report.read', 'report.export'
  )
on conflict do nothing;

-- CERTIFICATION_MANAGER: certification-focused.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name = 'CERTIFICATION_MANAGER'
  and p.key in ('agent.read', 'agent.certify', 'finding.read', 'report.read', 'report.export')
on conflict do nothing;

-- BUSINESS_OWNER / TECHNICAL_OWNER / APPLICATION_OWNER: read + agent.update
-- (needed to accept ownership / update contract details for owned agents).
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name in ('BUSINESS_OWNER', 'TECHNICAL_OWNER', 'APPLICATION_OWNER')
  and p.key in ('agent.read', 'agent.update', 'finding.read', 'report.read')
on conflict do nothing;

-- REQUESTER: minimal read + ability to request.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.tenant_id is null and r.name = 'REQUESTER'
  and p.key in ('agent.read', 'integration.read')
on conflict do nothing;
