-- Access Agent — ACCESS-P0-15 live checks of migration 0086 (the catalog
-- columns and their same-tenant references). Run via the Supabase MCP
-- execute_sql tool; nothing is left behind (every insert is expected to be
-- refused, and the last line counts any that were not).
--
-- Run 2026-09-26: the cross-tenant owner was 23503; the non-https URL was
-- 23514; forged rows 0. The integration case was skipped: the second
-- tenant had no integration. The same composite key pattern is proven for
-- integrations in tests/integration/identity-sources-isolation.sql.

create temporary table r (check_name text, result text);
do $$
declare ta uuid; tb uuid; pb uuid; ib uuid;
begin
  select id into ta from tenants where slug <> '' order by created_at limit 1;
  select id into tb from tenants where id <> ta order by created_at limit 1;
  select id into pb from identities where tenant_id = tb limit 1;
  select id into ib from integrations where tenant_id = tb limit 1;
  begin
    insert into applications (tenant_id, name, business_owner_identity_id) values (ta, 'forged-owner-check', pb);
    insert into r values ('app owned by another tenant''s identity (expect denied)', 'ALLOWED');
  exception when others then insert into r values ('app owned by another tenant''s identity (expect denied)', 'denied: ' || sqlstate); end;
  if ib is not null then
    begin
      insert into applications (tenant_id, name, source_integration_id) values (ta, 'forged-integration-check', ib);
      insert into r values ('app linked to another tenant''s integration (expect denied)', 'ALLOWED');
    exception when others then insert into r values ('app linked to another tenant''s integration (expect denied)', 'denied: ' || sqlstate); end;
  end if;
  begin
    insert into applications (tenant_id, name, url) values (ta, 'forged-url-check', 'javascript:alert(1)');
    insert into r values ('non-https url (expect denied)', 'ALLOWED');
  exception when others then insert into r values ('non-https url (expect denied)', 'denied: ' || sqlstate); end;
end $$;
select * from r union all select 'forged rows (expect 0)', count(*)::text from applications where name like 'forged-%-check';
