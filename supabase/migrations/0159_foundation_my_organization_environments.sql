-- Owner request (2026-10-13): an easier way to switch between an
-- organization's environments. Like my_tenant_environments() (0158), plus
-- the production organization an environment belongs to when the platform
-- linked them (0156), so the shell can group an organization's
-- environments and switch between them in one click. Only the caller's own
-- active memberships; nothing about any other organization. The shell reads
-- this one; 0158's stays for compatibility.
create function my_organization_environments()
returns table (tenant_id uuid, environment text, parent_tenant_id uuid)
language sql stable security definer set search_path = public as $$
  select tm.tenant_id, coalesce(p.environment, 'production'), p.parent_tenant_id
  from tenant_memberships tm
  left join platform_tenants p on p.tenant_id = tm.tenant_id
  where tm.user_id = auth.uid() and tm.status = 'active'
$$;
revoke execute on function my_organization_environments() from public, anon;
grant execute on function my_organization_environments() to authenticated;
