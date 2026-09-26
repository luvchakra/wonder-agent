-- FOUNDATION-P0-25 (WonderID Phase 4b, 2026-09-26) — system and custom
-- roles (IAM-003; docs/requirements/WonderID_User_Role_Permission_Management_Requirements.md
-- §15–17, 21–22, 53).
--
-- 1. Roles gain a display name, a status (an inactive role grants
--    nothing), who created them and when they changed, and what they were
--    copied from. The actor and source columns are plain uuids, not
--    foreign keys: a second relationship between these tables would make
--    existing PostgREST embeds ambiguous (see the 0096 incident).
-- 2. The specification's missing system roles: Agent, Runtime Security and
--    Governance Administrators, and Security Analyst. The existing keys
--    stay (Phase 4b decision 2); every system role gets its display name.
-- 3. System role definitions are protected in the database: no one —
--    service role included — changes a system role or its permissions,
--    except a migration that says so: a later migration that changes a
--    system role runs `set local wonderid.system_roles_change = 'allow';`
--    first (this one needs not: its triggers are created after its changes).
-- 4. Custom roles are tenant-owned, named uniquely in their tenant and
--    never with a system role's name. A role is only ever assigned inside
--    its own tenant (a trigger on user_roles).
--
-- Writes are the service's (service role, explicit tenant filter); RLS for
-- reads is unchanged: members see system roles and their own tenant's.

alter table roles
  add column display_name text,
  add column status text not null default 'active' check (status in ('active', 'inactive')),
  add column created_by uuid,
  add column copied_from uuid,
  add column updated_at timestamptz not null default now(),
  add constraint roles_custom_not_system check (tenant_id is null or is_system = false),
  add constraint roles_system_is_system check (tenant_id is not null or is_system = true);

create unique index roles_custom_name_key on roles (tenant_id, lower(name)) where tenant_id is not null;

update roles r
   set display_name = v.display_name
  from (values
    ('TENANT_SUPER_ADMIN', 'Tenant Administrator'),
    ('IAM_ADMIN', 'Identity Administrator'),
    ('IAM_ARCHITECT', 'IAM Architect'),
    ('SECURITY_ADMIN', 'Security Administrator'),
    ('CERTIFICATION_MANAGER', 'Certification Manager'),
    ('BUSINESS_OWNER', 'Business Owner'),
    ('TECHNICAL_OWNER', 'Technical Owner'),
    ('APPLICATION_OWNER', 'Application Owner'),
    ('AUDITOR', 'Auditor'),
    ('REQUESTER', 'Requester'),
    ('READ_ONLY', 'Read Only')
  ) as v(name, display_name)
 where r.tenant_id is null and r.name = v.name;

insert into roles (tenant_id, name, display_name, description, is_system)
select null, v.name, v.display_name, v.description, true
  from (values
    ('AGENT_ADMIN', 'Agent Administrator', 'Register, update, suspend and certify AI agents; manage discovery'),
    ('RUNTIME_SECURITY_ADMIN', 'Runtime Security Administrator', 'Run the runtime gateway: enforcement, emergency controls, runtime policies and findings'),
    ('GOVERNANCE_ADMIN', 'Governance Administrator', 'Govern policies, approvals, certifications and access reviews'),
    ('SECURITY_ANALYST', 'Security Analyst', 'Investigate risk, findings and runtime activity; read-only elsewhere')
  ) as v(name, display_name, description)
 where not exists (select 1 from roles r where r.tenant_id is null and r.name = v.name);

-- Custom roles: display name = name. Any row still unnamed gets its key.
update roles set display_name = name where display_name is null;
alter table roles alter column display_name set not null;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
  from (values
    ('AGENT_ADMIN', array['agent.read', 'agent.create', 'agent.update', 'agent.suspend', 'agent.certify', 'discovery.read', 'discovery.manage',
      'identity.read', 'access.read', 'runtime.read', 'risk.read', 'finding.read', 'compliance.read', 'policy.read', 'report.read',
      'integration.read', 'notification.manage']),
    ('RUNTIME_SECURITY_ADMIN', array['runtime.read', 'runtime.ingest', 'runtime.enforce', 'runtime.emergency', 'policy.read', 'policy.create',
      'policy.update', 'policy.publish', 'agent.read', 'agent.suspend', 'finding.read', 'finding.assign', 'finding.remediate', 'risk.read',
      'risk.manage', 'access.read', 'access.simulate', 'audit.read', 'report.read', 'notification.manage']),
    ('GOVERNANCE_ADMIN', array['policy.read', 'policy.create', 'policy.update', 'policy.publish', 'compliance.read', 'compliance.manage',
      'access.read', 'access.approve', 'access.simulate', 'agent.read', 'agent.certify', 'access_reviews.view', 'access_reviews.perform',
      'identity.read', 'risk.read', 'finding.read', 'report.read', 'report.export', 'audit.read', 'notification.manage']),
    ('SECURITY_ANALYST', array['agent.read', 'identity.read', 'access.read', 'access.simulate', 'runtime.read', 'risk.read', 'finding.read',
      'finding.assign', 'discovery.read', 'audit.read', 'report.read', 'compliance.read', 'policy.read', 'notification.manage'])
  ) as v(name, keys)
  join roles r on r.name = v.name and r.tenant_id is null
  join permissions p on p.key = any (v.keys)
on conflict do nothing;

-- ------------------------------------------------ system roles, protected

create function roles_protect_system() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('wonderid.system_roles_change', true), '') = 'allow' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if (tg_op <> 'INSERT' and old.tenant_id is null) or (tg_op <> 'DELETE' and new.tenant_id is null) then
    raise exception 'SYSTEM_ROLE_PROTECTED: system role definitions change only by migration' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke execute on function roles_protect_system() from public, anon, authenticated;

create trigger roles_protect_system
  before insert or update or delete on roles
  for each row execute function roles_protect_system();

create function role_permissions_protect_system() returns trigger
language plpgsql set search_path = public as $$
declare
  v_role uuid := case when tg_op = 'DELETE' then old.role_id else new.role_id end;
begin
  if coalesce(current_setting('wonderid.system_roles_change', true), '') = 'allow' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- A permission being removed from the catalog takes its grants with it.
  if tg_op = 'DELETE' and not exists (select 1 from permissions where id = old.permission_id) then
    return old;
  end if;
  if exists (select 1 from roles where id = v_role and tenant_id is null) then
    raise exception 'SYSTEM_ROLE_PROTECTED: system role permissions change only by migration' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke execute on function role_permissions_protect_system() from public, anon, authenticated;

create trigger role_permissions_protect_system
  before insert or update or delete on role_permissions
  for each row execute function role_permissions_protect_system();

-- ---------------------------------------------------------- custom roles

-- A custom role never borrows a system role's name or display name.
create function roles_custom_name_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.tenant_id is not null and exists (
    select 1 from roles s where s.tenant_id is null and (lower(s.name) = lower(new.name) or lower(s.display_name) = lower(new.name))
  ) then
    raise exception 'ROLE_NAME_RESERVED: that is a system role''s name' using errcode = '23505';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function roles_custom_name_guard() from public, anon, authenticated;

create trigger roles_custom_name_guard
  before insert or update on roles
  for each row execute function roles_custom_name_guard();

-- A role is assigned only inside its own tenant (system roles anywhere).
create function user_roles_role_in_tenant() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from roles r where r.id = new.role_id and (r.tenant_id is null or r.tenant_id = new.tenant_id)) then
    raise exception 'ROLE_NOT_IN_TENANT: that role belongs to another organization' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function user_roles_role_in_tenant() from public, anon, authenticated;

create trigger user_roles_role_in_tenant
  before insert or update on user_roles
  for each row execute function user_roles_role_in_tenant();

create index roles_tenant_idx on roles (tenant_id) where tenant_id is not null;
