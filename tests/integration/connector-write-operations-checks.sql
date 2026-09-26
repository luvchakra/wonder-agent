-- Integration Agent — INTEGRATION-P0-11 live checks of migration 0087
-- (connector_write_operations: the idempotency lock of the write
-- interface). Run via the Supabase MCP execute_sql tool; it removes what
-- it creates.
--
-- Run 2026-09-26: same key twice 23505; malformed key 23514; unknown
-- operation 23514; a member's direct write 42501; the member reads their
-- own tenant's record (1); nothing left behind. The cross-tenant case was
-- skipped (no other tenant had an integration); the (integration_id,
-- tenant_id) key pattern is proven in identity-sources-isolation.sql.

create temporary table r (check_name text, result text);
grant insert, select on r to authenticated;
do $$
declare ta uuid; tb uuid; ia uuid; ib uuid; ua uuid; fp text := repeat('a', 64);
begin
  select i.tenant_id, i.id into ta, ia from integrations i order by i.created_at limit 1;
  select i.tenant_id, i.id into tb, ib from integrations i where i.tenant_id <> ta order by i.created_at limit 1;
  select m.user_id into ua from tenant_memberships m where m.tenant_id = ta and m.status = 'active' limit 1;
  insert into connector_write_operations (tenant_id, integration_id, idempotency_key, operation, request_fingerprint, target)
    values (ta, ia, 'check-key-0087-a', 'revoke_access', fp, '{"accountId":"acc-1"}');
  begin
    insert into connector_write_operations (tenant_id, integration_id, idempotency_key, operation, request_fingerprint, target)
      values (ta, ia, 'check-key-0087-a', 'revoke_access', fp, '{"accountId":"acc-1"}');
    insert into r values ('same key twice (expect denied)', 'ALLOWED');
  exception when others then insert into r values ('same key twice (expect denied)', 'denied: ' || sqlstate); end;
  if ib is not null then
    begin
      insert into connector_write_operations (tenant_id, integration_id, idempotency_key, operation, request_fingerprint)
        values (ta, ib, 'check-key-0087-b', 'grant_access', fp);
      insert into r values ('A write on B integration (expect denied)', 'ALLOWED');
    exception when others then insert into r values ('A write on B integration (expect denied)', 'denied: ' || sqlstate); end;
  end if;
  begin
    insert into connector_write_operations (tenant_id, integration_id, idempotency_key, operation, request_fingerprint)
      values (ta, ia, 'bad key!', 'grant_access', fp);
    insert into r values ('malformed idempotency key (expect denied)', 'ALLOWED');
  exception when others then insert into r values ('malformed idempotency key (expect denied)', 'denied: ' || sqlstate); end;
  begin
    insert into connector_write_operations (tenant_id, integration_id, idempotency_key, operation, request_fingerprint)
      values (ta, ia, 'check-key-0087-c', 'drop_database', fp);
    insert into r values ('unknown operation (expect denied)', 'ALLOWED');
  exception when others then insert into r values ('unknown operation (expect denied)', 'denied: ' || sqlstate); end;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into connector_write_operations (tenant_id, integration_id, idempotency_key, operation, request_fingerprint)
      values (ta, ia, 'check-key-0087-d', 'grant_access', fp);
    insert into r values ('member writes directly, no client policy (expect denied)', 'ALLOWED');
  exception when others then insert into r values ('member writes directly, no client policy (expect denied)', 'denied: ' || sqlstate); end;
  insert into r select 'member sees own-tenant record (expect 1)', count(*)::text from connector_write_operations where idempotency_key = 'check-key-0087-a';
  execute 'reset role';
  delete from connector_write_operations where idempotency_key like 'check-key-0087-%';
end $$;
select * from r union all select 'left behind (expect 0)', count(*)::text from connector_write_operations where idempotency_key like 'check-key-0087-%';
