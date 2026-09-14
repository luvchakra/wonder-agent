-- Runtime Agent — hardening follow-up from get_advisors (performance),
-- same pattern as Access Agent's 0031_access_indexes.sql: cover every
-- foreign key the advisor flagged as unindexed.

create index runtime_events_agent_id_idx on runtime_events (agent_id);
create index runtime_events_identity_id_idx on runtime_events (identity_id);
create index runtime_tools_agent_id_idx on runtime_tools (agent_id);
