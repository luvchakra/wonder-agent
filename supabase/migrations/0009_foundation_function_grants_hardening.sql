-- Foundation Agent — hardening follow-up from get_advisors (security).
-- These functions are internal helpers / a narrowly-scoped self-service RPC,
-- not meant to be part of the general public REST surface. Postgres grants
-- EXECUTE to PUBLIC by default on function creation unless revoked.

revoke execute on function current_tenant_ids() from public;
revoke execute on function current_tenant_ids() from anon;
revoke execute on function current_tenant_ids() from authenticated;

revoke execute on function handle_new_user() from public;
revoke execute on function handle_new_user() from anon;
revoke execute on function handle_new_user() from authenticated;

-- create_tenant_with_owner is intentionally self-service, but only for
-- signed-in users — the function also checks auth.uid() internally as a
-- second, redundant guard.
revoke execute on function create_tenant_with_owner(text, text) from public;
revoke execute on function create_tenant_with_owner(text, text) from anon;
grant execute on function create_tenant_with_owner(text, text) to authenticated;
