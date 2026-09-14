-- Foundation Agent — critical fix, flagged by Platform Agent
-- (docs/design/platform-agent-backlog-audit.md, 2026-09-14) and verified
-- live: current_tenant_ids() (0004_foundation_rls.sql) filtered only on
-- tenant_memberships.status = 'active' and never checked tenants.status at
-- all, so suspending a tenant (Platform Agent's suspendTenant(), correctly
-- implemented) had zero actual enforcement effect — every RLS policy in
-- the system that calls this function (every module built so far)
-- continued granting a suspended tenant's active members full access.
--
-- This is an additive, backward-compatible change: same function name,
-- same signature, same return type, so every existing GRANT EXECUTE
-- (0009/0011) and every RLS policy that calls
-- `tenant_id in (select current_tenant_ids())` keeps working unchanged —
-- only the *result set* narrows to exclude tenants that are no longer
-- 'active', which is exactly the enforcement gap being closed.
create or replace function current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.tenant_id
  from tenant_memberships tm
  join tenants t on t.id = tm.tenant_id
  where tm.user_id = auth.uid()
    and tm.status = 'active'
    and t.status = 'active';
$$;
