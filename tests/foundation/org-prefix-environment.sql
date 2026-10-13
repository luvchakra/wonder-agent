-- Foundation/Platform — live verification of migration 0157 (owner request
-- 2026-10-13: choose the address prefix and environment at onboarding; a
-- platform administrator changes either later). Self-cleaning: one block
-- ending in an exception, so every fixture rolls back. Runs via execute_sql.
do $t$
declare
  u constant uuid := '11111111-1570-0000-0000-000000000001';
  other constant uuid := '11111111-1570-0000-0000-000000000002';
  t uuid;
  r text := '';
begin
  insert into auth.users (id, email) values (u, 'fx-prefix157@example.test'), (other, 'fx-other157@example.test');
  insert into users (id, email) values (u, 'fx-prefix157@example.test'), (other, 'fx-other157@example.test') on conflict (id) do nothing;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  r := r || 'available before=' || tenant_slug_available('fx-acme157-dev');
  t := create_first_tenant_for_current_user('Fixture Acme', 'fx-acme157-dev', 'development');
  r := r || ' | available after=' || tenant_slug_available('fx-acme157-dev') || ' | reserved word=' || tenant_slug_available('admin');
  r := r || ' | second first-org=' || coalesce(create_first_tenant_for_current_user('Again', 'fx-again157', 'production')::text, 'null');
  begin perform create_tenant_with_owner('Bad', 'fx-bad157', 'qa'); r := r || ' | bad env=ALLOWED'; exception when others then r := r || ' | bad env=refused ' || sqlstate; end;
  begin update tenants set slug = 'fx-hijack157' where id = t; r := r || ' | member renames=' || (select slug from tenants where id = t); exception when others then r := r || ' | member renames=refused ' || sqlstate; end;
  begin perform rename_tenant_slug(t, 'fx-mine157'); r := r || ' | member rename fn=ALLOWED'; exception when others then r := r || ' | member rename fn=refused ' || sqlstate; end;
  begin perform set_tenant_environment(t, 'production'); r := r || ' | member set env=ALLOWED'; exception when others then r := r || ' | member set env=refused ' || sqlstate; end;
  perform set_config('role', 'postgres', true);

  r := r || ' | env=' || (select environment from platform_tenants where tenant_id = t);
  r := r || ' | renamed from=' || rename_tenant_slug(t, 'fx-acme157-test');
  r := r || ' | slug now=' || (select slug from tenants where id = t) || ' | domain=' || (select string_agg(hostname, ',') from tenant_domains where tenant_id = t);
  r := r || ' | old resolves=' || (select count(*) from tenant_domains where hostname = 'fx-acme157-dev');
  begin perform rename_tenant_slug(t, 'Bad Prefix'); r := r || ' | invalid=ALLOWED'; exception when others then r := r || ' | invalid=refused ' || sqlstate; end;
  begin perform rename_tenant_slug(t, 'northwind-financial'); r := r || ' | taken=ALLOWED'; exception when others then r := r || ' | taken=refused ' || sqlstate; end;
  begin update tenants set slug = 'fx-direct157' where id = t; r := r || ' | direct update=ALLOWED'; exception when others then r := r || ' | direct update=refused ' || sqlstate; end;
  perform set_tenant_environment(t, 'test');
  r := r || ' | env changed=' || (select environment from platform_tenants where tenant_id = t);
  raise exception 'RESULTS: %', r;
end $t$;
