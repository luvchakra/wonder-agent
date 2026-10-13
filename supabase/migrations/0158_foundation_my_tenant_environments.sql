-- Owner request (2026-10-13): each environment has one designated colour,
-- the same for every organization, shown in the product so nobody mistakes
-- a test organization for production. The environment lives on the
-- vendor-side platform record (no client policies, 0038), so members read
-- it through this function: only the environment of organizations the
-- caller is an active member of, and nothing else. An organization with no
-- platform record is production.
create function my_tenant_environments()
returns table (tenant_id uuid, environment text)
language sql stable security definer set search_path = public as $$
  select tm.tenant_id, coalesce(p.environment, 'production')
  from tenant_memberships tm
  left join platform_tenants p on p.tenant_id = tm.tenant_id
  where tm.user_id = auth.uid() and tm.status = 'active'
$$;
revoke execute on function my_tenant_environments() from public, anon;
grant execute on function my_tenant_environments() to authenticated;

comment on function my_tenant_environments() is 'The environment (production, development, test, staging, sandbox) of each organization the caller is an active member of, for its colour in the shell (owner request 2026-10-13).';
