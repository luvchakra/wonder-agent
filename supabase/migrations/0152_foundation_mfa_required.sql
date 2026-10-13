-- FOUNDATION-P0-27: an organization can require multi-factor authentication
-- (Global Configuration `security.mfaRequired`, lib/config/registry.ts).
--
-- When it is on, a member's session reaches the organization's data only
-- after MFA (an aal2 session). This is enforced here, under every RLS
-- policy, as well as in getTenantContext(): current_tenant_ids() leaves the
-- organization out for an aal1 session, so a direct PostgREST call reads
-- and writes nothing either.
--
-- Exempt: automation members (tenant_memberships.account_type =
-- 'automation', FOUNDATION-P0-31). They act for an automation credential,
-- which cannot do MFA and is governed by its own four-eyes approval,
-- address list and expiry.
--
-- Only the stored value 1 means "required"; anything else is the default
-- (not required), the same rule as resolveConfig() in the application.
--
-- Same name, signature and grants as 0039's current_tenant_ids(), so every
-- policy keeps working; the result only narrows.

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
  left join tenant_settings s on s.tenant_id = tm.tenant_id
  where tm.user_id = auth.uid()
    and tm.status = 'active'
    and t.status = 'active'
    and (
      coalesce(s.settings -> 'config' ->> 'security.mfaRequired', '0') <> '1'
      or tm.account_type = 'automation'
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    );
$$;

-- The signed-in user's own active memberships, including organizations
-- whose data their session cannot reach yet because MFA is required. The
-- application needs these to ask for MFA instead of treating the person as
-- having no organization. Only the organization's name and slug, the
-- membership's account type and whether MFA is required: nothing else.
create function my_memberships()
returns table (tenant_id uuid, name text, slug text, account_type text, mfa_required boolean)
language sql
stable
security definer
set search_path = public
as $$
  select tm.tenant_id, t.name, t.slug, tm.account_type,
         coalesce(s.settings -> 'config' ->> 'security.mfaRequired', '0') = '1'
  from tenant_memberships tm
  join tenants t on t.id = tm.tenant_id
  left join tenant_settings s on s.tenant_id = tm.tenant_id
  where tm.user_id = auth.uid()
    and tm.status = 'active'
    and t.status = 'active';
$$;
revoke execute on function my_memberships() from public, anon;
grant execute on function my_memberships() to authenticated;

comment on function my_memberships() is 'The signed-in user''s active memberships with whether each organization requires MFA (FOUNDATION-P0-27).';
