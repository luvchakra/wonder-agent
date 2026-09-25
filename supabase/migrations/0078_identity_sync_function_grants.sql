-- IDENTITY-P0-15 follow-up (2026-09-26). 0077's `revoke all ... from public`
-- does not remove Supabase's default EXECUTE grants to anon/authenticated,
-- so the security advisor listed the three SECURITY DEFINER trigger
-- functions as callable through /rest/v1/rpc. Postgres already refuses to
-- run a trigger function outside a trigger; this removes the grants so
-- they are not exposed at all. The triggers themselves are unaffected.
revoke execute on function identity_sync_agent() from anon, authenticated;
revoke execute on function identity_sync_membership() from anon, authenticated;
revoke execute on function identity_sync_membership_status() from anon, authenticated;
