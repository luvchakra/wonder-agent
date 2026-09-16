-- Compliance Agent — QA fix (QA-P0-04.2/§15 index coverage)
-- Owner: Compliance Agent. See docs/design/ownership-map.md before modifying.
--
-- governance_attestations_tenant_agent_idx (0055) is a composite
-- (tenant_id, agent_id) index — it does not cover a lookup on agent_id
-- alone (e.g. the FK-constraint check on an agent delete), since agent_id
-- isn't the leading column. Found by mcp__Supabase__get_advisors(performance)
-- during QA's final re-verification pass: unindexed_foreign_keys flagged
-- governance_attestations_agent_id_fkey. CLAUDE.md §15 requires an index
-- for every foreign key.

create index governance_attestations_agent_id_idx on governance_attestations (agent_id);
