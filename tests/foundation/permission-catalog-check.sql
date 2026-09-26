-- Foundation Agent — FOUNDATION-P0-24 live verification of migration 0097
-- (the permission catalog). Run via the Supabase MCP execute_sql tool.
-- Read-only apart from attempts that must fail; nothing to clean up.
--
-- Proves: every permission is catalogued (resource, action, module, label,
-- sensitivity all present and within their vocabularies); a key without
-- them cannot be added; the §28 administrative keys exist and the Tenant
-- Administrator holds every permission; a signed-in member can read the
-- catalog but can neither add nor change a permission, nor attach one to
-- a role.

create temporary table check_results (check_name text, result text);
insert into check_results select 'uncatalogued permissions (expect 0)', count(*)::text from permissions
  where resource is null or action is null or module is null or label is null or sensitivity is null;
insert into check_results select 'modules in use (expect ADMINISTRATION,ASSURE,DISCOVER,GOVERN,PROTECT,UNDERSTAND)', string_agg(distinct module, ',' order by module) from permissions;
insert into check_results select '§28 keys present (expect 16)', count(*)::text from permissions where key in ('groups.view', 'groups.create', 'groups.update', 'groups.delete',
  'groups.manage_members', 'roles.view', 'roles.create', 'roles.update', 'roles.delete', 'roles.assign', 'permissions.view', 'access_reviews.view',
  'access_reviews.perform', 'tenant.security.manage', 'authentication.manage', 'mfa.manage');
insert into check_results select 'permissions the Tenant Administrator lacks (expect 0)', count(*)::text from permissions p
  where not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id where rp.permission_id = p.id and r.tenant_id is null and r.name = 'TENANT_SUPER_ADMIN');
do $$ begin
  insert into permissions (key, description) values ('fixture.uncatalogued', 'x');
  insert into check_results values ('add an uncatalogued key (expect denied 23502)', 'ALLOWED');
exception when others then insert into check_results values ('add an uncatalogued key (expect denied 23502)', 'denied: ' || sqlstate); end $$;
do $$ begin
  insert into permissions (key, description, resource, action, module, label, sensitivity) values ('fixture.bad', 'x', 'fixture', 'bad', 'ELSEWHERE', 'x', 'standard');
  insert into check_results values ('add a key outside the modules (expect denied 23514)', 'ALLOWED');
exception when others then insert into check_results values ('add a key outside the modules (expect denied 23514)', 'denied: ' || sqlstate); end $$;

grant insert, select on check_results to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
insert into check_results select 'member reads the catalog (expect > 60)', count(*)::text from permissions;
do $$ begin
  insert into permissions (key, description, resource, action, module, label, sensitivity) values ('fixture.invented', 'x', 'fixture', 'invented', 'GOVERN', 'x', 'standard');
  insert into check_results values ('member invents a permission (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('member invents a permission (expect denied 42501)', 'denied: ' || sqlstate); end $$;
with u as (update permissions set sensitivity = 'standard' where key = 'runtime.emergency' returning 1)
insert into check_results select 'member downgrades a permission (expect 0)', count(*)::text from u;
do $$ begin
  insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.name = 'READ_ONLY' and r.tenant_id is null and p.key = 'runtime.emergency';
  insert into check_results values ('member attaches a permission to a role (expect denied 42501)', 'ALLOWED');
exception when others then insert into check_results values ('member attaches a permission to a role (expect denied 42501)', 'denied: ' || sqlstate); end $$;
reset role;
select * from check_results;
