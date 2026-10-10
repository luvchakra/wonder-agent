-- Integration Agent — covering indexes for two composite foreign keys.
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.
--
-- connector_files and connector_traffic reference integrations by
-- (integration_id, tenant_id) (0110, 0111), but neither had an index
-- leading with that pair (Supabase advisor 0001_unindexed_foreign_keys), so
-- deleting a connection scanned both tables. Additive; applied 2026-10-10.

create index if not exists connector_files_integration_tenant_idx on connector_files (integration_id, tenant_id);
create index if not exists connector_traffic_integration_tenant_idx on connector_traffic (integration_id, tenant_id);
