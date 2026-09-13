-- Foundation Agent — fixes a self-inflicted regression from 0009: RLS
-- policies call current_tenant_ids() as the querying role (not as the
-- security-definer function owner), so authenticated/anon MUST retain
-- EXECUTE or every RLS-protected query fails outright with
-- "permission denied for function current_tenant_ids". 0009 over-corrected
-- a get_advisors WARN about REST/RPC exposure; the fix for that concern is
-- accepting it as reviewed (the function only ever returns the caller's own
-- tenant memberships — no cross-tenant data), not revoking EXECUTE, since
-- RLS evaluation and RPC callability share the same grant in Postgres/PostgREST.
grant execute on function current_tenant_ids() to authenticated;
grant execute on function current_tenant_ids() to anon;
