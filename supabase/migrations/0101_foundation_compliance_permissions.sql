-- Foundation Agent — FOUNDATION-P0-28 (2026-10-01, explicit user request:
-- payments, GDPR/DPDP, SOX/financial compliance, IT security).
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.
--
-- 1. The permission keys the billing (Platform Agent, 0102) and privacy
--    (Compliance Agent, 0103) capabilities are gated on. Catalogued like
--    every key since 0097; only migrations add keys.
-- 2. has_tenant_permission(tenant, key): a database-side permission check
--    for RLS policies on sensitive tables (invoices, data-subject requests,
--    breach records) that must not be readable by every member of a tenant.
--    It is deliberately NARROWER than getTenantContext(): it honours only
--    tenant-wide, currently valid, active-role grants (direct or through an
--    active group), MFA-conditioned ones only on an aal2 session, and never
--    the resource-scoped ones. The
--    application's authorization engine (requirePermission(), explicit
--    DENY policies included) remains the enforcement; this is defence in
--    depth so a member's own JWT cannot read those rows through PostgREST.

insert into permissions (key, description, resource, action, module, label, sensitivity) values
  ('billing.view', 'View the subscription, invoices and billing profile', 'billing', 'view', 'ADMINISTRATION', 'View billing', 'sensitive'),
  ('billing.manage', 'Change plan, pay, cancel and edit the billing profile', 'billing', 'manage', 'ADMINISTRATION', 'Manage billing', 'privileged'),
  ('privacy.view', 'View the privacy programme: records of processing, retention, requests and incidents', 'privacy', 'view', 'ASSURE', 'View privacy programme', 'sensitive'),
  ('privacy.manage', 'Configure privacy contacts, records of processing, consent purposes, retention and legal holds', 'privacy', 'manage', 'ASSURE', 'Manage privacy programme', 'privileged'),
  ('privacy.requests.process', 'Verify, process and decide data-subject and data-principal requests', 'privacy_requests', 'process', 'ASSURE', 'Process privacy requests', 'privileged'),
  ('privacy.incidents.manage', 'Record and manage personal-data breach incidents and notifications', 'privacy_incidents', 'manage', 'ASSURE', 'Manage breach incidents', 'privileged')
on conflict (key) do nothing;

-- System roles change only by migration (0098's guard reads this setting).
set local wonderid.system_roles_change = 'allow';

-- Tenant Administrator: everything.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
  and p.key in ('billing.view', 'billing.manage', 'privacy.view', 'privacy.manage', 'privacy.requests.process', 'privacy.incidents.manage')
on conflict do nothing;
-- Governance Administrator: runs the privacy programme.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'GOVERNANCE_ADMIN'
  and p.key in ('privacy.view', 'privacy.manage', 'privacy.requests.process')
on conflict do nothing;
-- Security Administrator: owns breach response.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'SECURITY_ADMIN'
  and p.key in ('privacy.view', 'privacy.incidents.manage')
on conflict do nothing;
-- Auditor: sees the privacy programme and billing records, changes nothing.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'AUDITOR'
  and p.key in ('privacy.view', 'billing.view')
on conflict do nothing;

set local wonderid.system_roles_change = '';

create or replace function has_tenant_permission(p_tenant uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from current_tenant_ids() t where t = p_tenant)
     and exists (
       select 1
         from (
           select ur.role_id, ur.scope_type, ur.starts_at, ur.expires_at, ur.requires_mfa
             from user_roles ur
            where ur.tenant_id = p_tenant and ur.user_id = auth.uid()
           union all
           select gr.role_id, gr.scope_type, gr.starts_at, gr.expires_at, gr.requires_mfa
             from group_members gm
             join groups g on g.id = gm.group_id and g.status = 'active'
             join group_roles gr on gr.group_id = gm.group_id
            where gm.tenant_id = p_tenant and gm.user_id = auth.uid()
         ) a
         join roles r on r.id = a.role_id and r.status = 'active'
         join role_permissions rp on rp.role_id = r.id
         join permissions p on p.id = rp.permission_id and p.key = p_key
        where a.scope_type = 'tenant'
          and (not a.requires_mfa or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
          and (a.starts_at is null or a.starts_at <= now())
          and (a.expires_at is null or a.expires_at > now())
     );
$$;

revoke execute on function has_tenant_permission(uuid, text) from public, anon;
grant execute on function has_tenant_permission(uuid, text) to authenticated;
