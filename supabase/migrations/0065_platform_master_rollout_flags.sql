-- Platform Agent — PLATFORM-P0-12: the master stories' rollout flags (§26).
-- Owner: Platform Agent. Additive: new catalog rows only; existing flags
-- and per-tenant overrides are untouched.
--
-- Defaults follow the master stories' "initial safe rollout": discovery,
-- inventory, access analysis and runtime observation ON; runtime
-- enforcement OFF. Enforcement is switched on per tenant with an override,
-- after validation. Flags for capabilities not built yet are catalogued
-- OFF, so turning one on before its feature exists changes nothing.

insert into platform_feature_flags (key, display_name, description, default_enabled) values
  ('agent_discovery', 'Agent discovery', 'Discover AI agents from connected systems', true),
  ('nhi_discovery', 'NHI discovery', 'Discover non-human identities that are not AI agents (not built yet)', false),
  ('shadow_ai', 'Shadow AI', 'Surface unregistered AI activity from runtime telemetry (not built yet)', false),
  ('access_graph', 'Access graph', 'Effective access graph and access paths', true),
  ('runtime_observe', 'Runtime Gateway (observe)', 'Agents may call the Runtime Gateway; decisions are recorded', true),
  ('runtime_enforce', 'Runtime Gateway (enforce)', 'Gateway decisions are enforced: DENY and REQUIRE_APPROVAL stop the agent', false),
  ('runtime_approval', 'Runtime approvals', 'Human approval of REQUIRE_APPROVAL requests (not built yet)', false),
  ('tool_filtering', 'Tool filtering', 'Agents may ask the gateway which tools they may be shown', true),
  ('jit_access', 'JIT access', 'Just-in-time, expiring access grants (not built yet)', false),
  ('credential_brokering', 'Credential brokering', 'Short-lived, scoped credentials brokered by the gateway (not built yet)', false),
  ('data_authorization', 'Data-level authorization', 'Record- and field-level runtime restrictions (not built yet)', false),
  ('behavioral_detection', 'Behavioral detection', 'Statistical behavioural baselines and anomalies (not built yet)', false),
  ('agent_simulation', 'Agent simulation', 'Simulate access and decisions without executing them (not built yet)', false)
on conflict (key) do nothing;
