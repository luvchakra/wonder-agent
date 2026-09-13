-- Identity Agent — hardening follow-up from get_advisors (performance).
-- tenant_id is the column every RLS policy filters on; index it on every
-- new table the same way Foundation's own tables already are.

create index agent_contracts_tenant_id_idx on agent_contracts (tenant_id);
create index agent_identities_tenant_id_idx on agent_identities (tenant_id);
create index agent_lifecycle_events_tenant_id_idx on agent_lifecycle_events (tenant_id);
create index agent_owners_tenant_id_idx on agent_owners (tenant_id);
create index agent_relationships_tenant_id_idx on agent_relationships (tenant_id);
