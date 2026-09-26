-- FOUNDATION-P0-26 (WonderID Phase 4b, 2026-09-26) — groups (IAM-004;
-- docs/requirements/WonderID_User_Role_Permission_Management_Requirements.md
-- §11–12, 38).
--
-- 1. groups, group_members and group_roles: tenant-owned, RLS select for
--    the tenant's members, writes by the service (service role, explicit
--    tenant filter). A group member must be a member of the same tenant
--    (composite foreign key to tenant_memberships), and a group's role is a
--    system role or the same tenant's custom role (trigger).
-- 2. Effective permissions combine direct and group roles
--    (getTenantContext()), resolved per request, so a membership change
--    takes effect on the next request — there is no cache to invalidate.
-- 3. No escalation through groups, in the database: nobody adds themselves
--    to a group, and nobody gives a role to a group they belong to.
-- 4. The user directory gains a group filter.
--
-- Actor columns are plain uuids (see the 0096 note on PostgREST embeds).

create table groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 500),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create unique index groups_tenant_name_key on groups (tenant_id, lower(name));

create table group_members (
  group_id uuid not null,
  tenant_id uuid not null,
  user_id uuid not null,
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  foreign key (group_id, tenant_id) references groups (id, tenant_id) on delete cascade,
  foreign key (tenant_id, user_id) references tenant_memberships (tenant_id, user_id) on delete cascade,
  constraint group_members_no_self_add check (added_by is null or added_by <> user_id)
);
create index group_members_tenant_user_idx on group_members (tenant_id, user_id);

create table group_roles (
  group_id uuid not null,
  tenant_id uuid not null,
  role_id uuid not null references roles (id) on delete cascade,
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (group_id, role_id),
  foreign key (group_id, tenant_id) references groups (id, tenant_id) on delete cascade
);
create index group_roles_role_idx on group_roles (role_id);
create index group_roles_tenant_idx on group_roles (tenant_id);

alter table groups enable row level security;
alter table group_members enable row level security;
alter table group_roles enable row level security;
create policy groups_select on groups for select using (tenant_id in (select current_tenant_ids()));
create policy group_members_select on group_members for select using (tenant_id in (select current_tenant_ids()));
create policy group_roles_select on group_roles for select using (tenant_id in (select current_tenant_ids()));

create function groups_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function groups_touch() from public, anon, authenticated;
create trigger groups_touch before update on groups for each row execute function groups_touch();

-- A group's role is a system role or its own tenant's custom role, and is
-- never granted by someone in the group (that would be self-escalation).
create function group_roles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from roles r where r.id = new.role_id and (r.tenant_id is null or r.tenant_id = new.tenant_id)) then
    raise exception 'ROLE_NOT_IN_TENANT: that role belongs to another organization' using errcode = '23514';
  end if;
  if new.granted_by is not null and exists (select 1 from group_members m where m.group_id = new.group_id and m.user_id = new.granted_by) then
    raise exception 'SELF_ESCALATION: members of a group cannot give it roles' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function group_roles_guard() from public, anon, authenticated;
create trigger group_roles_guard before insert or update on group_roles for each row execute function group_roles_guard();

-- ------------------------------------------------ directory: group filter

drop function tenant_user_directory(uuid, text, text, text, integer, integer);
create function tenant_user_directory(p_tenant uuid, p_search text, p_status text, p_role text, p_limit integer, p_offset integer, p_group uuid default null)
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
