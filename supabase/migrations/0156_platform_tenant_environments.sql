-- Owner request (2026-10-13): an organization can have environments — dev,
-- test, staging — each at its own address next to the production one:
--   production  https://acme.<BASE_APP_HOST>
--   development https://acme-dev.<BASE_APP_HOST>
--   test        https://acme-test.<BASE_APP_HOST>
--
-- Owner decisions (2026-10-13):
-- - An environment is its own organization (tenant) with its own data,
--   users and connections, linked to the production one. Nothing is shared:
--   every table stays tenant-scoped under RLS (non-negotiables #1, #4), and
--   configuration moves between them through configuration bundles.
-- - Only platform administrators create environments (vendor console).
--
-- platform_tenants (vendor-only, no client policies, 0038) records each
-- tenant's environment and, for a non-production one, the production
-- organization it belongs to. The address is the slug (`acme-dev`), served
-- by the existing tenant_domains trigger (0095), so no routing change.

alter table platform_tenants drop constraint platform_tenants_environment_check;
alter table platform_tenants
  add constraint platform_tenants_environment_check check (environment in ('production', 'development', 'test', 'staging', 'sandbox')),
  -- No foreign key: a second key to tenants made PostgREST's `tenants(...)`
  -- embed from platform_tenants ambiguous and broke the vendor console
  -- (found 2026-10-13 right after applying). create_tenant_environment()
  -- checks the parent exists; tenants are deprovisioned, never deleted.
  add column parent_tenant_id uuid,
  add constraint platform_tenants_parent_not_self check (parent_tenant_id is distinct from tenant_id),
  add constraint platform_tenants_production_has_no_parent check (environment <> 'production' or parent_tenant_id is null);

-- One environment of each kind per organization.
create unique index platform_tenants_parent_environment_key on platform_tenants (parent_tenant_id, environment) where parent_tenant_id is not null;

-- An organization with no platform record (self-service sign-up) counts as
-- production.

-- Creates an environment of a production organization in one transaction:
-- the tenant (slug `<parent>-<suffix>`), its settings, its platform record,
-- and the parent's active administrators (TENANT_SUPER_ADMIN) as its
-- administrators, so someone can sign in to it. Returns the new tenant id.
-- Service role only: the platform console calls it after
-- requirePlatformAdmin() and writes the platform audit event.
create function create_tenant_environment(p_parent uuid, p_environment text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  parent tenants%rowtype;
  suffix text;
  label text;
  new_id uuid;
  admin_role uuid;
begin
  suffix := case p_environment when 'development' then 'dev' when 'test' then 'test' when 'staging' then 'staging' end;
  if suffix is null then
    raise exception 'environment must be development, test or staging' using errcode = '22023';
  end if;
  select * into parent from tenants where id = p_parent;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if parent.status <> 'active' then
    raise exception 'the organization is not active' using errcode = '22023';
  end if;
  if exists (select 1 from platform_tenants where tenant_id = p_parent and environment <> 'production') then
    raise exception 'environments belong to a production organization' using errcode = '22023';
  end if;
  label := case p_environment when 'development' then 'Dev' when 'test' then 'Test' else 'Staging' end;

  insert into tenants (name, slug) values (left(parent.name, 180) || ' (' || label || ')', parent.slug || '-' || suffix)
  returning id into new_id;
  insert into tenant_settings (tenant_id) values (new_id) on conflict (tenant_id) do nothing;
  insert into platform_tenants (tenant_id, environment, parent_tenant_id) values (new_id, p_environment, p_parent)
  on conflict (tenant_id) do update set environment = excluded.environment, parent_tenant_id = excluded.parent_tenant_id;

  select id into admin_role from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';
  insert into tenant_memberships (tenant_id, user_id, status)
  select distinct new_id, ur.user_id, 'active'
  from user_roles ur
  join tenant_memberships tm on tm.tenant_id = ur.tenant_id and tm.user_id = ur.user_id and tm.status = 'active'
  where ur.tenant_id = p_parent and ur.role_id = admin_role;
  insert into user_roles (tenant_id, user_id, role_id)
  select new_id, m.user_id, admin_role from tenant_memberships m where m.tenant_id = new_id;

  return new_id;
end
$$;
revoke execute on function create_tenant_environment(uuid, text) from public, anon, authenticated;
grant execute on function create_tenant_environment(uuid, text) to service_role;

comment on function create_tenant_environment(uuid, text) is 'Owner request 2026-10-13: a development, test or staging environment of a production organization, as its own tenant at <slug>-<suffix>. Platform console only (service role).';
