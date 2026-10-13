-- Owner decision (13 October 2026): the WonderApps dashboard keeps its
-- read access to WonderID, under a switch a platform administrator can
-- turn off and on from the vendor console (/platform-admin/health).
--
-- Background: the `wonderapps_dashboard` role (created outside this
-- repository; first noted 2026-10-11 in the Foundation audit log) belongs
-- to WonderApps, the owner's company platform. It runs read-only aggregate
-- queries across organizations through `wonderapps_dashboard_read`
-- policies (SELECT ... USING (true)) on 27 tables. A policy alone gives no
-- access: the role reads only the tables it holds SELECT on. This
-- migration makes those grants the switch:
-- - on: SELECT on each table that has the policy, except the AI provider
--   settings, where only the non-secret columns are granted (never
--   `encrypted_api_key`, non-negotiable #10);
-- - off: every grant revoked, so the role reads nothing.
-- Each change is made by the service, with the platform administrator and
-- the before/after state written to platform_audit_logs (#11).
--
-- This is vendor access across organizations, which non-negotiable #4
-- otherwise forbids; it exists only on the owner's explicit decision,
-- visible and reversible in the console. Both functions are callable by
-- the service role only.

create or replace function wonderapps_dashboard_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from pg_roles where rolname = 'wonderapps_dashboard')
     and has_table_privilege('wonderapps_dashboard', 'public.tenants', 'SELECT');
$$;

create or replace function set_wonderapps_dashboard_access(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  if not exists (select 1 from pg_roles where rolname = 'wonderapps_dashboard') then
    raise exception 'The wonderapps_dashboard role does not exist in this database';
  end if;
  for t in
    select distinct schemaname, tablename from pg_policies
     where policyname = 'wonderapps_dashboard_read' and schemaname = 'public' and tablename <> 'platform_ai_provider_configs'
  loop
    if p_enabled then
      execute format('grant select on %I.%I to wonderapps_dashboard', t.schemaname, t.tablename);
    else
      execute format('revoke select on %I.%I from wonderapps_dashboard', t.schemaname, t.tablename);
    end if;
  end loop;
  if p_enabled then
    execute 'grant usage on schema public to wonderapps_dashboard';
    execute 'grant select (tenant_id, provider, use_own_key, model, updated_by, created_at, updated_at) on public.platform_ai_provider_configs to wonderapps_dashboard';
  else
    -- Revoking at table level also revokes the column grants.
    execute 'revoke select on public.platform_ai_provider_configs from wonderapps_dashboard';
  end if;
  return wonderapps_dashboard_access();
end
$$;

revoke execute on function wonderapps_dashboard_access() from public, anon, authenticated;
revoke execute on function set_wonderapps_dashboard_access(boolean) from public, anon, authenticated;
grant execute on function wonderapps_dashboard_access() to service_role;
grant execute on function set_wonderapps_dashboard_access(boolean) to service_role;
