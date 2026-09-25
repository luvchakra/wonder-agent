-- Runtime Agent — RUNTIME-P0-16 (master stories P0-18): a normalized
-- runtime event vocabulary, plus session, decision and MCP fields.
-- Owner: Runtime Agent. Additive: every existing column, constraint and
-- caller keeps working.
--
-- event_type separates what an agent *did* (the observed actions DID is
-- computed from) from what the gateway *decided* and from session
-- bookkeeping. DID reads only the observed types; see
-- modules/runtime-assurance/did.ts.

alter table runtime_events drop constraint runtime_events_source_check;
alter table runtime_events add constraint runtime_events_source_check
  check (source in ('mcp', 'rest', 'webhook', 'gateway'));

alter table runtime_events add column event_type text not null default 'API_CALL'
  check (event_type in (
    'AUTHENTICATION', 'SESSION_STARTED', 'SESSION_ENDED',
    'TOOL_REQUEST', 'TOOL_ALLOWED', 'TOOL_DENIED', 'TOOL_APPROVAL_REQUIRED', 'TOOL_EXECUTED',
    'API_CALL', 'DATA_ACCESS', 'DELEGATION', 'POLICY_DECISION'
  ));

-- Backfill existing rows: every one of them was an observed action. The
-- type is inferred from what the row recorded (the same rule
-- ingestRuntimeEvent() applies when a source sends no type).
update runtime_events set event_type = case
  when tool is not null then 'TOOL_EXECUTED'
  when resource is not null or data_classification is not null then 'DATA_ACCESS'
  else 'API_CALL'
end;

alter table runtime_events add column session_id text;
alter table runtime_events add column decision_id uuid references runtime_decisions(id) on delete set null;
alter table runtime_events add column mcp_server text;

create index runtime_events_decision_idx on runtime_events (decision_id);
create index runtime_events_tenant_session_idx on runtime_events (tenant_id, session_id) where session_id is not null;
create index runtime_events_tenant_agent_type_time_idx on runtime_events (tenant_id, agent_id, event_type, event_time);
