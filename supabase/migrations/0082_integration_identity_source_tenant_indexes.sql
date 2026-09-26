-- INTEGRATION-P0-08/09 follow-up (2026-09-26): 0081 left the tenant_id
-- foreign keys of identity_reconciliation_runs and identity_source_links
-- without a leading index (a catalog check after applying it found them;
-- §15). Indexes only.
create index identity_reconciliation_runs_tenant_idx on identity_reconciliation_runs (tenant_id);
create index identity_source_links_tenant_idx on identity_source_links (tenant_id);
