-- Foundation Agent — WID-H07: live verification of the audit trail's
-- integrity rules (migration 0104).
--
-- Proves:
-- - an audit row cannot be changed or deleted, even by the service role;
-- - the retention purge refuses to touch the last 365 days;
-- - an active legal hold on audit logs stops the purge;
-- - once released, the purge removes only the oldest rows, records what it
--   removed, and the remaining chain still verifies.
--
-- Self-cleaning: one block ending in an exception, so every fixture rolls
-- back. Runs through the Supabase MCP execute_sql tool. The final
-- exception's message is the result: 'AUDIT TRAIL CHECKS PASSED' or the
-- first check that failed.

do $t$
declare
  ta constant uuid := 'aaaaaaaa-1400-0000-0000-000000000001';
  holder constant uuid := '11111111-1400-0000-0000-000000000001';
  hold_id uuid;
  n bigint;
  v record;
  refused boolean;
begin
insert into tenants (id, name, slug) values (ta, 'Fixture Tenant H07', 'fixture-tenant-h07-test');
insert into auth.users (id, email) values (holder, 'fixture-holder-h07@example.test');
insert into users (id, email) values (holder, 'fixture-holder-h07@example.test') on conflict (id) do nothing;

-- Two rows: one 400 days old, one now. The chain trigger links them.
insert into audit_logs (tenant_id, actor_type, action, object_type, object_id, outcome, created_at)
values (ta, 'system', 'fixture.old', 'tenant', ta, 'success', now() - interval '400 days');
insert into audit_logs (tenant_id, actor_type, action, object_type, object_id, outcome)
values (ta, 'system', 'fixture.new', 'tenant', ta, 'success');

-- 1. Rows cannot be changed.
refused := false;
begin
  update audit_logs set action = 'fixture.tampered' where tenant_id = ta;
exception when insufficient_privilege then refused := true;
end;
if not refused then raise exception 'FAILED: an audit row could be updated'; end if;

-- 2. Rows cannot be deleted outside the purge.
refused := false;
begin
  delete from audit_logs where tenant_id = ta;
exception when insufficient_privilege then refused := true;
end;
if not refused then raise exception 'FAILED: an audit row could be deleted'; end if;

-- 3. The purge never reaches into the last 365 days.
refused := false;
begin
  perform purge_audit_logs(ta, now() - interval '30 days');
exception when invalid_parameter_value then refused := true;
end;
if not refused then raise exception 'FAILED: the purge accepted a cut inside 365 days'; end if;

-- 4. An active legal hold on audit logs stops the purge.
insert into privacy_legal_holds (tenant_id, name, reason, data_categories, placed_by)
values (ta, 'Fixture hold', 'Fixture litigation hold for the audit test', array['audit_logs'], holder)
returning id into hold_id;
n := purge_audit_logs(ta, now() - interval '366 days');
if n <> 0 then raise exception 'FAILED: the purge removed % rows under a legal hold', n; end if;
if (select count(*) from audit_logs where tenant_id = ta) <> 2 then raise exception 'FAILED: rows went missing under a legal hold'; end if;

-- 5. Released, the purge removes only the old row and records it; the chain still verifies.
update privacy_legal_holds set released_at = now(), released_by = holder where id = hold_id;
n := purge_audit_logs(ta, now() - interval '366 days');
if n <> 1 then raise exception 'FAILED: the purge removed % rows, expected 1', n; end if;
if (select count(*) from audit_logs where tenant_id = ta and action = 'fixture.new') <> 1 then raise exception 'FAILED: the recent row was removed'; end if;
if (select count(*) from audit_log_purges where tenant_id = ta and purged_count = 1) <> 1 then raise exception 'FAILED: the purge was not recorded'; end if;
select * into v from verify_audit_chain(ta);
if v.broken_at_seq is not null or v.checked <> 1 then raise exception 'FAILED: the chain does not verify after the purge (%)', v.reason; end if;

raise exception 'AUDIT TRAIL CHECKS PASSED';
end
$t$;
