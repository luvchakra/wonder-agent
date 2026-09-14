-- QA-P0-12 security scanning finding: two SECURITY DEFINER functions were
-- executable by roles that never legitimately need to call them directly.
-- Non-breaking: authenticated keeps EXECUTE on current_tenant_ids() since
-- every tenant-scoped RLS policy in this database depends on it.
revoke execute on function public.current_tenant_ids() from anon;
revoke execute on function public.rls_auto_enable() from public;
