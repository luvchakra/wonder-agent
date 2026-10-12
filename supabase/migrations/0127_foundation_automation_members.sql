-- Foundation Agent — FOUNDATION-P0-31, part 2: an automation credential's
-- backing member is not a person.
-- Owner: Foundation Agent (directory functions); the identity trigger is
-- the Identity Agent's (0077), changed here additively and recorded in
-- both modules' audit logs.
--
-- 1. identity_sync_membership() creates a HUMAN identity for every new
--    membership. An 'automation' membership is skipped: the credential is
--    governed through the APPLICATION identity it belongs to.
-- 2. The users directory and its summary leave automation members out;
--    they are managed on Admin → Automation credentials.
--
-- Same signatures; behaviour for every other membership is unchanged.

-- 1.
create or replace function identity_sync_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u record;
begin
  if new.account_type = 'automation' then
    return new;
  end if;
  select id, email, display_name into u from users where id = new.user_id;
  if u.id is null then
    return new;
  end if;
  insert into identities (tenant_id, identity_type, subtype, display_name, email, username, user_id, status,
                          lifecycle_state, source_system)
  values (new.tenant_id, 'HUMAN', 'employee', coalesce(nullif(u.display_name, ''), u.email), u.email, u.email, u.id,
          case when new.status = 'active' then 'active' else 'inactive' end,
          case when new.status = 'active' then 'ACTIVE' else 'DISABLED' end, 'wonderid')
  on conflict (tenant_id, user_id) where user_id is not null do nothing;
  return new;
end
$$;
revoke all on function identity_sync_membership() from public;
revoke execute on function identity_sync_membership() from anon, authenticated;

-- 2.
create or replace function tenant_user_directory(p_tenant uuid, p_search text, p_status text, p_role text, p_limit integer, p_offset integer, p_group uuid default null)
returns table (
  user_id uuid, email text, display_name text, status text, account_type text, job_title text, department text,
  roles text[], last_sign_in_at timestamptz, joined_at timestamptz, total bigint
)
language sql stable security definer set search_path = public as $$
  with pattern as (
    select case when nullif(btrim(p_search), '') is null then null
                else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as q
  ), base as (
    select m.user_id, u.email, u.display_name, m.status, m.account_type, i.title as job_title, i.department,
           coalesce((select array_agg(r.name order by r.name) from user_roles ur join roles r on r.id = ur.role_id
                      where ur.tenant_id = m.tenant_id and ur.user_id = m.user_id), '{}') as roles,
           au.last_sign_in_at, m.created_at as joined_at
      from tenant_memberships m
      join users u on u.id = m.user_id
      left join auth.users au on au.id = m.user_id
      left join identities i on i.tenant_id = m.tenant_id and i.user_id = m.user_id and i.identity_type = 'HUMAN'
      cross join pattern
     where m.tenant_id = p_tenant
       and m.account_type <> 'automation'
       and ((p_status is null and m.status <> 'removed') or m.status = p_status)
       and (pattern.q is null or u.email ilike pattern.q or u.display_name ilike pattern.q)
       and (p_role is null or exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                                       where ur.tenant_id = m.tenant_id and ur.user_id = m.user_id and r.name = p_role))
       and (p_group is null or exists (select 1 from group_members gm where gm.tenant_id = m.tenant_id and gm.user_id = m.user_id and gm.group_id = p_group))
  )
  select b.*, count(*) over () as total
    from base b
   order by lower(coalesce(b.display_name, b.email)), b.user_id
   limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
$$;
revoke execute on function tenant_user_directory(uuid, text, text, text, integer, integer, uuid) from public, anon, authenticated;
grant execute on function tenant_user_directory(uuid, text, text, text, integer, integer, uuid) to service_role;

create or replace function tenant_user_summary(p_tenant uuid)
returns table (total bigint, active bigint, invited bigint, suspended bigint, deactivated bigint, administrators bigint)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where m.status <> 'removed'),
         count(*) filter (where m.status = 'active'),
         count(*) filter (where m.status = 'invited'),
         count(*) filter (where m.status = 'suspended'),
         count(*) filter (where m.status = 'deactivated'),
         count(*) filter (where m.status = 'active' and exists (
           select 1 from user_roles ur join roles r on r.id = ur.role_id and r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
            where ur.tenant_id = m.tenant_id and ur.user_id = m.user_id))
    from tenant_memberships m
   where m.tenant_id = p_tenant
     and m.account_type <> 'automation'
$$;
revoke execute on function tenant_user_summary(uuid) from public, anon, authenticated;
grant execute on function tenant_user_summary(uuid) to service_role;
