-- Foundation Agent — FOUNDATION-P0-31: automation credentials for the
-- administration API (decision D11, approved 2026-10-12; design §8.2).
-- Owner: Foundation Agent. See docs/design/ownership-map.md before
-- modifying.
--
-- An integrator's pipeline or a customer's ITSM calls /api/v1/* with
-- `Authorization: Bearer wa_ac_…` instead of a person's browser session.
--
-- 1. automation_credentials. One credential belongs to a tenant-owned
--    non-human identity (APPLICATION, its owner and review apply). It has
--    a hashed secret shown once, an expiry of at most a year (90 days by
--    default), an optional source-address allowlist, a per-minute rate
--    limit, and revocation. It is created 'pending' and becomes 'active'
--    only when a second person approves it: four-eyes, enforced here, not
--    only in the service. Extending it is four-eyes too.
--    Each credential acts through a backing member of the organization (a
--    users row with an 'automation' membership). Its roles, scoped
--    assignments (0100), RLS and the authorization engine apply exactly as
--    for a person. The backing account can never sign in: its password is
--    random, held encrypted and never shown, and the proxy refuses its
--    cookie sessions.
-- 2. automation_credential_usage + automation_credential_hit(): the
--    per-minute call counter behind the rate limit (service role only).
--    One small row per credential per minute it is used; pruning old rows
--    is a recorded follow-up (a retention job), not done here.
-- 3. tenant_memberships.account_type gains 'automation'.
-- 4. Permission automation.manage (Tenant Administrator), and a built-in
--    role template "Configuration Administrator": integrations, policies,
--    organization settings and notifications, and no personal data.
--
-- Additive only.

-- 1.
create table automation_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  identity_id uuid not null,
  backing_user_id uuid not null unique references users(id) on delete cascade,
  backing_secret_enc text not null,
  name text not null check (char_length(name) between 1 and 120),
  key_prefix text not null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  expires_at timestamptz not null,
  requested_expires_at timestamptz,
  extension_requested_by uuid references users(id),
  allowed_cidrs text[] not null default '{}' check (cardinality(allowed_cidrs) <= 20),
  rate_limit_per_minute integer not null default 120 check (rate_limit_per_minute between 1 and 10000),
  created_by uuid not null references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  revoked_by uuid references users(id),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 500),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_credentials_identity_fkey foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  -- Four-eyes: the person who created a credential never approves it.
  constraint automation_credentials_four_eyes check (approved_by is null or approved_by <> created_by),
  constraint automation_credentials_active_approved check (status <> 'active' or approved_by is not null),
  constraint automation_credentials_extension_pair check ((requested_expires_at is null) = (extension_requested_by is null)),
  constraint automation_credentials_revoked_pair check ((status = 'revoked') = (revoked_at is not null))
);
create index automation_credentials_tenant_idx on automation_credentials (tenant_id, status);
create index automation_credentials_identity_fk_idx on automation_credentials (identity_id, tenant_id);
create index automation_credentials_created_by_idx on automation_credentials (created_by);
create index automation_credentials_approved_by_idx on automation_credentials (approved_by) where approved_by is not null;
create index automation_credentials_revoked_by_idx on automation_credentials (revoked_by) where revoked_by is not null;
create index automation_credentials_extension_by_idx on automation_credentials (extension_requested_by) where extension_requested_by is not null;

alter table automation_credentials enable row level security;
-- Read only by those who manage them; written only by the service (no client write policy).
create policy automation_credentials_select on automation_credentials
  for select using (has_tenant_permission(tenant_id, 'automation.manage'));

-- 2.
create table automation_credential_usage (
  credential_id uuid not null references automation_credentials(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  minute timestamptz not null,
  calls integer not null default 0,
  primary key (credential_id, minute)
);
create index automation_credential_usage_tenant_idx on automation_credential_usage (tenant_id);
alter table automation_credential_usage enable row level security;
-- No policies: only the service role reads or writes it.

create function automation_credential_hit(p_credential uuid, p_tenant uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  insert into automation_credential_usage (credential_id, tenant_id, minute, calls)
  values (p_credential, p_tenant, date_trunc('minute', now()), 1)
  on conflict (credential_id, minute) do update set calls = automation_credential_usage.calls + 1
  returning calls into n;
  return n;
end
$$;
revoke execute on function automation_credential_hit(uuid, uuid) from public, anon, authenticated;

-- 3.
alter table tenant_memberships drop constraint tenant_memberships_account_type_check;
alter table tenant_memberships add constraint tenant_memberships_account_type_check
  check (account_type in ('internal', 'external', 'automation'));

-- 4.
insert into permissions (key, description, resource, action, module, label, sensitivity) values
  ('automation.manage', 'Create, approve, rotate, extend and revoke automation credentials for the administration API', 'automation_credentials', 'manage', 'ADMINISTRATION', 'Manage automation credentials', 'privileged')
on conflict (key) do nothing;

-- System roles change only by migration (0098's guard reads this setting).
set local wonderid.system_roles_change = 'allow';

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN' and p.key = 'automation.manage'
on conflict do nothing;

insert into roles (tenant_id, name, display_name, description, is_system)
select null, 'CONFIGURATION_ADMIN', 'Configuration Administrator',
       'Configures integrations, policies, organization settings and notifications; no access to personal data. A template for integrators and automation credentials.', true
where not exists (select 1 from roles where tenant_id is null and name = 'CONFIGURATION_ADMIN');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'CONFIGURATION_ADMIN'
  and p.key in ('integration.read', 'integration.create', 'integration.update', 'integration.execute',
                'policy.read', 'policy.create', 'policy.update',
                'tenant.settings', 'notification.manage', 'roles.view', 'permissions.view')
on conflict do nothing;
