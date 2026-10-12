-- Runtime Agent with Identity Agent — WID-C03 (owner decision 12 October
-- 2026): a per-agent "gateway only" setting.
--
-- agents.gateway_only: when true, an action the agent takes around the
-- Runtime Gateway is a critical finding and the agent is suspended at the
-- gateway at once (automatic remediation the owner approved under #15).
--
-- runtime_emergency_controls gains the 'agent_suspension' control: target
-- is the agent's id; while it is active, every gateway call for that agent
-- is denied in every mode. It is engaged by the system (engaged_by null)
-- on a bypass, or by an administrator, and lifted like any other control.
--
-- Additive; no policy change (agents keeps its policies; the controls
-- table has no client write policy).

alter table agents add column gateway_only boolean not null default false;

alter table runtime_emergency_controls drop constraint runtime_emergency_controls_control_type_check;
alter table runtime_emergency_controls add constraint runtime_emergency_controls_control_type_check
  check (control_type in ('kill_switch', 'tool_suspension', 'mcp_server_suspension', 'session_termination', 'agent_suspension'));
