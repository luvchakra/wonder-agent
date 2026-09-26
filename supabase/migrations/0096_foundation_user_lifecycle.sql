-- FOUNDATION-P0-23 (WonderID Phase 4b, 2026-09-26) — users and the
-- membership lifecycle (IAM-001; docs/requirements/WonderID_User_Role_Permission_Management_Requirements.md
-- §5–8, 23–24, 30–34).
--
-- 1. Membership lifecycle: statuses invited, active, suspended,
--    deactivated and removed (only `active` reaches tenant data —
--    current_tenant_ids() is unchanged). Every status change records when,
--    by whom and why; invitations record who invited and when; the
--    account type (internal or external — service accounts are machine
--    identities, not members) and the chosen authentication method.
-- 2. No self-escalation, in the database: nobody grants themselves a role
--    (`user_roles.granted_by <> user_id`) and nobody changes their own
--    membership status, except accepting their own invitation.
-- 3. Last-administrator protection, in the database: no suspension,
--    deactivation, removal or role removal may leave an organization
--    without an active Tenant Administrator. Serialized on the tenant row,
--    so two administrators cannot remove each other at once.
-- 4. users.* permission keys.
-- 5. Service-role-only functions: the paged, filtered user directory
--    (users' e-mail and last sign-in live outside the tenant's RLS reach),
--    its summary counts, and listing and revoking a user's sessions.

-- ------------------------------------------------------------ memberships
--
-- The actor columns (status_changed_by, invited_by, user_roles.granted_by)
-- are plain user ids, deliberately without foreign keys to `users`: a
-- second relationship between these tables makes every existing PostgREST
-- `users(...)` embed ambiguous (PGRST201). The first application of this
-- migration had them and broke /api/v1/users and /settings/roles until a
-- follow-up step (0096_foundation_user_lifecycle_actor_columns) dropped
-- them; this file is the corrected, equivalent end state. The actors are
-- also recorded in the audit log.

alter table tenant_memberships drop constraint tenant_memberships_status_check;
alter table tenant_memberships
  add constraint tenant_memberships_status_check check (status in ('active', 'invited', 'suspended', 'deactivated', 'removed'));

alter table tenant_memberships
  add column updated_at timestamptz not null default now(),
  add column status_reason text check (status_reason is null or char_length(status_reason) <= 1000),
  add column status_changed_at timestamptz,
  add column status_changed_by uuid,
  add column invited_by uuid,
  add column invited_at timestamptz,
  add column account_type text not null default 'internal' check (account_type in ('internal', 'external')),
  add column auth_method text check (auth_method in ('tenant_default', 'password', 'sso'));

create index tenant_memberships_tenant_status_idx on tenant_memberships (tenant_id, status);

-- search_path pinned (security advisor); applied to the live project as
-- the step 0096_foundation_user_lifecycle_search_paths, together with the
-- same fix for 0095's tenants_guard_slug_and_suspension().
create function tenant_memberships_guard_self_change() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status_changed_by is not null and new.status_changed_by = new.user_id
       and not (old.status = 'invited' and new.status = 'active') then
      raise exception 'SELF_STATUS_CHANGE: a member cannot change their own membership status' using errcode = '42501';
    end if;
    new.status_changed_at := coalesce(new.status_changed_at, now());
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function tenant_memberships_guard_self_change() from public, anon, authenticated;

create trigger tenant_memberships_guard_self_change
  before update on tenant_memberships
  for each row execute function tenant_memberships_guard_self_change();

-- ------------------------------------------------------------- user roles

alter table user_roles
  add column granted_by uuid,
  add constraint user_roles_no_self_grant check (granted_by is null or granted_by <> user_id);

-- ------------------------------------------------- last-administrator guard

-- Active members holding the system Tenant Administrator role, other than p_excluding.
create function tenant_admins_remaining(p_tenant uuid, p_excluding uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(distinct ur.user_id)::integer
    from user_roles ur
    join roles r on r.id = ur.role_id and r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
    join tenant_memberships m on m.tenant_id = ur.tenant_id and m.user_id = ur.user_id and m.status = 'active'
   where ur.tenant_id = p_tenant and ur.user_id <> p_excluding
$$;
revoke execute on function tenant_admins_remaining(uuid, uuid) from public, anon, authenticated;

create function guard_last_tenant_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := old.tenant_id;
  v_user uuid := old.user_id;
  v_applies boolean;
begin
  if tg_table_name = 'tenant_memberships' then
    -- Only an active member leaving `active` can reduce the count.
    v_applies := old.status = 'active' and (tg_op = 'DELETE' or new.status <> 'active')
      and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id and r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN'
                   where ur.tenant_id = v_tenant and ur.user_id = v_user);
  else
    v_applies := exists (select 1 from roles r where r.id = old.role_id and r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN')
      and exists (select 1 from tenant_memberships m where m.tenant_id = v_tenant and m.user_id = v_user and m.status = 'active');
  end if;
  if not v_applies then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- A cascade from a deleted organization or a deleted account is not an
  -- administrator being removed from a living organization.
  perform 1 from tenants where id = v_tenant for update;
  if not found or not exists (select 1 from users where id = v_user) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tenant_admins_remaining(v_tenant, v_user) = 0 then
    raise exception 'LAST_TENANT_ADMIN: this would leave the organization without a Tenant Administrator' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke execute on function guard_last_tenant_admin() from public, anon, authenticated;

create trigger tenant_memberships_last_admin
  before update of status or delete on tenant_memberships
  for each row execute function guard_last_tenant_admin();
create trigger user_roles_last_admin
  before delete on user_roles
  for each row execute function guard_last_tenant_admin();

-- ------------------------------------------------------------ permissions

insert into permissions (key, description) values
  ('users.view', 'View the organization''s users, their roles, effective permissions, access history and sessions'),
  ('users.invite', 'Invite people to the organization'),
  ('users.create', 'Add people to the organization immediately'),
  ('users.update', 'Edit users'' details'),
  ('users.suspend', 'Suspend, reactivate and deactivate users, and revoke their sessions'),
  ('users.remove', 'Remove users from the organization')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN' and p.key like 'users.%'
on conflict do nothing;

-- The Identity Administrator runs the people lifecycle, short of removal.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'IAM_ADMIN' and p.key in ('users.view', 'users.invite', 'users.create', 'users.update', 'users.suspend')
on conflict do nothing;

-- Security responds to incidents (suspend, revoke sessions); auditors see who has what.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'SECURITY_ADMIN' and p.key in ('users.view', 'users.suspend')
on conflict do nothing;
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.tenant_id is null and r.name = 'AUDITOR' and p.key = 'users.view'
on conflict do nothing;

-- ------------------------------------------------------- user directory

-- One page of an organization's users with search and filters, and the
-- total. Service role only: the caller has already verified users.view in
-- that tenant, and passes the server-resolved tenant id.
create function tenant_user_directory(p_tenant uuid, p_search text, p_status text, p_role text, p_limit integer, p_offset integer)
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
  )
  select b.*, count(*) over () as total
    from base b
   order by lower(coalesce(b.display_name, b.email)), b.user_id
   limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
$$;
revoke execute on function tenant_user_directory(uuid, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function tenant_user_directory(uuid, text, text, text, integer, integer) to service_role;

create function tenant_user_summary(p_tenant uuid)
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
$$;
revoke execute on function tenant_user_summary(uuid) from public, anon, authenticated;
grant execute on function tenant_user_summary(uuid) to service_role;

-- ------------------------------------------------------------- sessions

-- A user's live sessions: when they started, when last active, the
-- browser. Not the IP address. Service role only.
create function user_sessions(p_user uuid)
returns table (session_id uuid, created_at timestamptz, last_active_at timestamptz, user_agent text, aal text)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at), s.user_agent, s.aal::text
    from auth.sessions s
   where s.user_id = p_user and (s.not_after is null or s.not_after > now())
   order by 3 desc
   limit 50
$$;
revoke execute on function user_sessions(uuid) from public, anon, authenticated;
grant execute on function user_sessions(uuid) to service_role;

-- Ends every session a user holds (their refresh tokens go with them). The
-- proxy verifies the session with the auth server on every request, so
-- the user's next request is refused. Service role only.
create function revoke_user_sessions(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function revoke_user_sessions(uuid) to service_role;

-- A member's access history reads the audit log by object (applied as a
-- second step of this migration, 0096_foundation_user_lifecycle_history_index).
create index audit_logs_tenant_object_idx on audit_logs (tenant_id, object_id, created_at desc);
