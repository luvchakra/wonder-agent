-- Follow-up to 0049: "revoke ... from public" does not strip an earlier
-- explicit grant to a named role in Postgres — revoke explicitly instead.
revoke execute on function public.rls_auto_enable() from anon, authenticated;
