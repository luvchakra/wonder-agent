-- IDENTITY-P0-12 (master stories P0-09) — Shadow AI discovery from runtime
-- telemetry. Runtime-owned: an event naming an agent that is not
-- registered in this tenant is quarantined (never recorded as DID, never
-- dropped) with what it claimed to be, so Identity's discovery inbox can
-- surface it for a person to register, link or ignore.
--
-- Additive only: three nullable columns on runtime_event_quarantine (0043).
-- `agent_id` there is a foreign key to agents, so an unregistered agent's
-- claimed id or name goes in `observed_agent_ref` instead. Existing rows
-- keep null. RLS and the select-only policy are unchanged; writes stay
-- service-role only.

alter table runtime_event_quarantine
  add column observed_agent_ref text check (observed_agent_ref is null or char_length(observed_agent_ref) <= 200),
  add column application text check (application is null or char_length(application) <= 200),
  add column tool text check (tool is null or char_length(tool) <= 200);

-- The discovery read: this tenant's unregistered-agent rows, newest first.
create index runtime_event_quarantine_unregistered_idx
  on runtime_event_quarantine (tenant_id, received_at desc)
  where reason = 'UNREGISTERED_AGENT';
