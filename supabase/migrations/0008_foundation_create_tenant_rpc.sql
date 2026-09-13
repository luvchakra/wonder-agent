-- Foundation Agent — FOUNDATION-P0-03.2
-- Owner: Foundation Agent.
--
-- Self-service tenant creation is a chicken-and-egg problem under RLS: a
-- brand-new tenant has no members yet, so a plain client INSERT into
-- `tenants`/`tenant_memberships` would need a policy permissive enough to
-- undermine tenant isolation elsewhere. Instead, expose one narrow
-- security-definer RPC that performs tenant + settings + membership +
-- TENANT_SUPER_ADMIN role assignment atomically, scoped to the calling
-- user's own auth.uid() only.

create or replace function create_tenant_with_owner(tenant_name text, tenant_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
  super_admin_role_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to create a tenant';
  end if;

  insert into tenants (name, slug) values (tenant_name, tenant_slug)
  returning id into new_tenant_id;

  insert into tenant_settings (tenant_id) values (new_tenant_id);

  insert into tenant_memberships (tenant_id, user_id, status)
  values (new_tenant_id, auth.uid(), 'active');

  select id into super_admin_role_id
  from roles where tenant_id is null and name = 'TENANT_SUPER_ADMIN';

  insert into user_roles (tenant_id, user_id, role_id)
  values (new_tenant_id, auth.uid(), super_admin_role_id);

  return new_tenant_id;
end;
$$;

-- Callable by any authenticated user; the function itself scopes every write
-- to auth.uid(), so it cannot be used to act on another user's behalf.
grant execute on function create_tenant_with_owner(text, text) to authenticated;
