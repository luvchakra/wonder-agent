-- IDENTITY-P0-15/16 follow-up (2026-09-26). The performance advisor listed
-- 0077's same-tenant composite foreign keys as unindexed: the owner,
-- sponsor and manager indexes were single-column, and the relationship
-- indexes led with tenant_id, so none covered (col, tenant_id). These
-- replace them with covering indexes (which still serve the service's
-- equality filters on both columns) and index the created_by references.
-- Indexes only; no data or policy changes.

drop index if exists identities_owner_idx;
drop index if exists identities_sponsor_idx;
drop index if exists identities_manager_idx;
create index identities_owner_fk_idx on identities (owner_identity_id, tenant_id);
create index identities_sponsor_fk_idx on identities (sponsor_identity_id, tenant_id);
create index identities_manager_fk_idx on identities (manager_identity_id, tenant_id);
create index identities_agent_fk_idx on identities (agent_id, tenant_id);
create index identities_created_by_idx on identities (created_by);

drop index if exists identity_relationships_source_idx;
drop index if exists identity_relationships_target_idx;
create index identity_relationships_source_fk_idx on identity_relationships (source_identity_id, tenant_id);
create index identity_relationships_target_fk_idx on identity_relationships (target_identity_id, tenant_id);
create index identity_relationships_created_by_idx on identity_relationships (created_by);

create index identity_attribute_definitions_created_by_idx on identity_attribute_definitions (created_by);
