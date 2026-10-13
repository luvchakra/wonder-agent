-- Owner feedback (2026-10-13): an organization whose own address ends in an
-- environment suffix (planet-express-dev, set up as development) gave its
-- new environments stacked suffixes (planet-express-dev-staging). An
-- environment's address is now the organization's prefix without that
-- suffix plus its own: planet-express-staging. Otherwise as in 0161.
create or replace function create_tenant_environment(p_parent uuid, p_environment text) returns uuid
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
  -- Any top-level organization holds environments, whatever its own one
  -- is (an organization set up as development can add test and staging).
  if exists (select 1 from platform_tenants where tenant_id = p_parent and parent_tenant_id is not null) then
    raise exception 'environments belong to an organization, not to another environment' using errcode = '22023';
  end if;
  if coalesce((select environment from platform_tenants where tenant_id = p_parent), 'production') = p_environment then
    raise exception 'the organization itself is that environment' using errcode = '23505';
  end if;
  label := case p_environment when 'development' then 'Dev' when 'test' then 'Test' else 'Staging' end;

  insert into tenants (name, slug) values (left(parent.name, 180) || ' (' || label || ')', regexp_replace(parent.slug, '-(dev|test|staging)$', '') || '-' || suffix)
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
