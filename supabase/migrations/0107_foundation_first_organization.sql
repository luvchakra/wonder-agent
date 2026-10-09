-- Foundation Agent — first organization on sign-up.
-- Owner: Foundation Agent.
--
-- A brand-new account used to land on /onboarding and type an organization
-- name before it could see the product. The user asked for that screen to
-- go: a new account now gets its first organization automatically, named
-- from the account, and renames it in Administration → Organization.
--
-- This wraps create_tenant_with_owner() (0008) with the two checks that
-- make an automatic creation safe, done in the database so concurrent
-- first requests (a double redirect, two tabs) cannot race:
--
--   1. A per-user transaction advisory lock serializes the check-and-create,
--      so one account gets exactly one automatic organization.
--   2. It creates nothing (returns null) for an account that already has ANY
--      membership row — active, invited, suspended or removed — or is a
--      platform administrator. Invited people choose their invitation on
--      /onboarding; people removed from an organization are not silently
--      given a new one; platform administrators hold no tenant membership by
--      design (non-negotiable #3).
--
-- Every write is still scoped to auth.uid() by create_tenant_with_owner().

create or replace function create_first_tenant_for_current_user(tenant_name text, tenant_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Must be authenticated to create a tenant';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('first-tenant:' || caller::text, 0));

  if exists (select 1 from tenant_memberships where user_id = caller)
     or exists (select 1 from platform_admins where user_id = caller) then
    return null;
  end if;

  return create_tenant_with_owner(tenant_name, tenant_slug);
end;
$$;

revoke execute on function create_first_tenant_for_current_user(text, text) from public;
revoke execute on function create_first_tenant_for_current_user(text, text) from anon;
grant execute on function create_first_tenant_for_current_user(text, text) to authenticated;
