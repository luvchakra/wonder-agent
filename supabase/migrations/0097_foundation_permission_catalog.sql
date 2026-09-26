-- FOUNDATION-P0-24 (WonderID Phase 4b, 2026-09-26) — the permission
-- catalog (IAM-002; docs/requirements/WonderID_User_Role_Permission_Management_Requirements.md
-- §13–14, 28).
--
-- The existing keys stay the stable permission ids (Phase 4b decision 1:
-- nothing is renamed; code and roles keep using them). Each gains the
-- catalog's vocabulary — resource and action in the specification's
-- `<resource>.<action>` terms, the product module it belongs to, a display
-- label and a sensitivity — and the columns become required, so no key
-- can exist uncatalogued. Customers cannot invent ids: the table stays
-- readable-only to them (0004), and only migrations add keys.
--
-- The administrative keys of §28 that have no existing equivalent are
-- added (groups.*, roles.*, permissions.view, access_reviews.*,
-- tenant.security.manage, authentication.manage, mfa.manage). Existing
-- keys cover the rest (sso.manage; runtime.emergency is the kill switch;
-- role.manage stays the gate until FOUNDATION-P0-25 moves assignment to
-- roles.assign).

alter table permissions
  add column resource text,
  add column action text,
  add column module text,
  add column label text,
  add column sensitivity text;

update permissions p
   set resource = v.resource, action = v.action, module = v.module, label = v.label, sensitivity = v.sensitivity
  from (values
    ('access.approve', 'access_requests', 'approve', 'GOVERN', 'Approve access requests', 'sensitive'),
    ('access.manage', 'access', 'manage', 'GOVERN', 'Manage applications, accounts and entitlements', 'privileged'),
    ('access.read', 'access', 'view', 'UNDERSTAND', 'View effective access', 'standard'),
    ('access.request', 'access_requests', 'create', 'GOVERN', 'Request access', 'standard'),
    ('access.simulate', 'access', 'analyze', 'UNDERSTAND', 'Simulate access and policy changes', 'standard'),
    ('agent.certify', 'certifications', 'perform', 'GOVERN', 'Certify agent access', 'sensitive'),
    ('agent.create', 'agents', 'create', 'DISCOVER', 'Register AI agents', 'standard'),
    ('agent.delete', 'agents', 'delete', 'DISCOVER', 'Delete or retire AI agents', 'privileged'),
    ('agent.read', 'agents', 'view', 'DISCOVER', 'View AI agents', 'standard'),
    ('agent.suspend', 'agents', 'suspend', 'PROTECT', 'Suspend or restrict AI agents', 'sensitive'),
    ('agent.update', 'agents', 'update', 'DISCOVER', 'Update AI agents', 'standard'),
    ('ai.manage', 'ai_providers', 'manage', 'ADMINISTRATION', 'Configure the AI provider', 'privileged'),
    ('audit.read', 'audit', 'view', 'ASSURE', 'View the audit trail', 'standard'),
    ('compliance.manage', 'certifications', 'manage', 'GOVERN', 'Run certification campaigns and controls', 'sensitive'),
    ('compliance.read', 'certifications', 'view', 'GOVERN', 'View certifications and controls', 'standard'),
    ('discovery.manage', 'discovery', 'manage', 'DISCOVER', 'Register, link or dismiss discoveries', 'standard'),
    ('discovery.read', 'discovery', 'view', 'DISCOVER', 'View discovery and shadow AI', 'standard'),
    ('finding.assign', 'findings', 'assign', 'ASSURE', 'Assign findings', 'standard'),
    ('finding.read', 'findings', 'view', 'ASSURE', 'View findings', 'standard'),
    ('finding.remediate', 'findings', 'remediate', 'ASSURE', 'Start remediation of findings', 'sensitive'),
    ('identity.manage', 'identities', 'update', 'UNDERSTAND', 'Create and update identities', 'sensitive'),
    ('identity.read', 'identities', 'view', 'UNDERSTAND', 'View identities', 'standard'),
    ('integration.create', 'integrations', 'create', 'ADMINISTRATION', 'Create integrations', 'sensitive'),
    ('integration.execute', 'integrations', 'sync', 'ADMINISTRATION', 'Run integration syncs', 'standard'),
    ('integration.read', 'integrations', 'view', 'ADMINISTRATION', 'View integrations', 'standard'),
    ('integration.update', 'integrations', 'update', 'ADMINISTRATION', 'Update integration configuration', 'sensitive'),
    ('notification.manage', 'notifications', 'manage', 'ADMINISTRATION', 'Manage your notification preferences', 'standard'),
    ('policy.create', 'policies', 'create', 'GOVERN', 'Create policies', 'standard'),
    ('policy.delete', 'policies', 'delete', 'GOVERN', 'Delete policies', 'privileged'),
    ('policy.publish', 'policies', 'publish', 'GOVERN', 'Publish policy versions', 'sensitive'),
    ('policy.read', 'policies', 'view', 'GOVERN', 'View policies', 'standard'),
    ('policy.update', 'policies', 'update', 'GOVERN', 'Update policies', 'standard'),
    ('report.export', 'evidence', 'export', 'ASSURE', 'Export reports and evidence', 'sensitive'),
    ('report.read', 'reports', 'view', 'ASSURE', 'View reports', 'standard'),
    ('risk.manage', 'risk', 'remediate', 'ASSURE', 'Assign, remediate and resolve risk', 'sensitive'),
    ('risk.read', 'risk', 'view', 'ASSURE', 'View risk and evidence', 'standard'),
    ('role.manage', 'roles', 'manage', 'ADMINISTRATION', 'Manage role assignments', 'privileged'),
    ('runtime.emergency', 'runtime', 'kill_switch', 'PROTECT', 'Use emergency controls (kill switch)', 'privileged'),
    ('runtime.enforce', 'runtime', 'control', 'PROTECT', 'Switch gateways between observe and enforce', 'privileged'),
    ('runtime.ingest', 'runtime', 'ingest', 'PROTECT', 'Submit runtime events', 'sensitive'),
    ('runtime.read', 'runtime', 'view', 'PROTECT', 'View runtime activity', 'standard'),
    ('sso.manage', 'sso', 'manage', 'ADMINISTRATION', 'Manage single sign-on', 'privileged'),
    ('tenant.settings', 'tenant', 'settings', 'ADMINISTRATION', 'Manage organization settings', 'privileged'),
    ('user.manage', 'users', 'list', 'ADMINISTRATION', 'List members through the API', 'standard'),
    ('users.create', 'users', 'create', 'ADMINISTRATION', 'Add users now', 'sensitive'),
    ('users.invite', 'users', 'invite', 'ADMINISTRATION', 'Invite users', 'sensitive'),
    ('users.remove', 'users', 'remove', 'ADMINISTRATION', 'Remove users', 'privileged'),
    ('users.suspend', 'users', 'suspend', 'ADMINISTRATION', 'Suspend users and end their sessions', 'privileged'),
    ('users.update', 'users', 'update', 'ADMINISTRATION', 'Edit users', 'sensitive'),
    ('users.view', 'users', 'view', 'ADMINISTRATION', 'View users', 'standard')
  ) as v(key, resource, action, module, label, sensitivity)
 where p.key = v.key;

insert into permissions (key, description, resource, action, module, label, sensitivity) values
  ('groups.view', 'View groups, their members and roles', 'groups', 'view', 'ADMINISTRATION', 'View groups', 'standard'),
  ('groups.create', 'Create groups', 'groups', 'create', 'ADMINISTRATION', 'Create groups', 'sensitive'),
  ('groups.update', 'Rename and describe groups', 'groups', 'update', 'ADMINISTRATION', 'Edit groups', 'sensitive'),
  ('groups.delete', 'Delete groups', 'groups', 'delete', 'ADMINISTRATION', 'Delete groups', 'privileged'),
  ('groups.manage_members', 'Add and remove group members', 'groups', 'manage_members', 'ADMINISTRATION', 'Manage group members', 'sensitive'),
  ('roles.view', 'View roles and their permissions', 'roles', 'view', 'ADMINISTRATION', 'View roles', 'standard'),
  ('roles.create', 'Create custom roles', 'roles', 'create', 'ADMINISTRATION', 'Create custom roles', 'privileged'),
  ('roles.update', 'Change custom roles', 'roles', 'update', 'ADMINISTRATION', 'Edit custom roles', 'privileged'),
  ('roles.delete', 'Retire custom roles', 'roles', 'delete', 'ADMINISTRATION', 'Retire custom roles', 'privileged'),
  ('roles.assign', 'Assign roles to users and groups', 'roles', 'assign', 'ADMINISTRATION', 'Assign roles', 'privileged'),
  ('permissions.view', 'View the permission catalog', 'permissions', 'view', 'ADMINISTRATION', 'View the permission catalog', 'standard'),
  ('access_reviews.view', 'View access reviews of users', 'access_reviews', 'view', 'GOVERN', 'View access reviews', 'standard'),
  ('access_reviews.perform', 'Certify or revoke users'' access in a review', 'access_reviews', 'perform', 'GOVERN', 'Perform access reviews', 'sensitive'),
  ('tenant.security.manage', 'Change the organization''s security profile', 'tenant_security', 'manage', 'ADMINISTRATION', 'Manage the security profile', 'privileged'),
  ('authentication.manage', 'Change how people sign in', 'authentication', 'manage', 'ADMINISTRATION', 'Manage authentication', 'privileged'),
  ('mfa.manage', 'Change multi-factor authentication requirements', 'mfa', 'manage', 'ADMINISTRATION', 'Manage MFA', 'privileged')
on conflict (key) do nothing;

-- Every key is catalogued, now and from here on.
alter table permissions
  alter column resource set not null,
  alter column action set not null,
  alter column module set not null,
  alter column label set not null,
  alter column sensitivity set not null,
  add constraint permissions_module_check check (module in ('DISCOVER', 'UNDERSTAND', 'GOVERN', 'PROTECT', 'ASSURE', 'ADMINISTRATION')),
  add constraint permissions_sensitivity_check check (sensitivity in ('standard', 'sensitive', 'privileged')),
  add constraint permissions_resource_action_check check (resource ~ '^[a-z][a-z_]*$' and action ~ '^[a-z][a-z_]*$');

-- The new keys: the Tenant Administrator holds all of them.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
  and p.key in ('groups.view', 'groups.create', 'groups.update', 'groups.delete', 'groups.manage_members', 'roles.view', 'roles.create',
                'roles.update', 'roles.delete', 'roles.assign', 'permissions.view', 'access_reviews.view', 'access_reviews.perform',
                'tenant.security.manage', 'authentication.manage', 'mfa.manage')
on conflict do nothing;
-- Identity Administrator: groups and reviews; sees roles and the catalog.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ADMIN'
  and p.key in ('groups.view', 'groups.create', 'groups.update', 'groups.manage_members', 'roles.view', 'permissions.view', 'access_reviews.view', 'access_reviews.perform')
on conflict do nothing;
-- Security Administrator: the security profile and authentication.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'SECURITY_ADMIN'
  and p.key in ('tenant.security.manage', 'authentication.manage', 'mfa.manage', 'groups.view', 'roles.view', 'permissions.view')
on conflict do nothing;
-- Auditor: sees who can do what.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'AUDITOR' and p.key in ('groups.view', 'roles.view', 'permissions.view', 'access_reviews.view')
on conflict do nothing;
-- Certification Manager: runs access reviews.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'CERTIFICATION_MANAGER' and p.key in ('access_reviews.view', 'access_reviews.perform', 'permissions.view')
on conflict do nothing;

