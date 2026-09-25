-- RISK-P0-12 (master stories P0-20/P0-21) — two new deterministic finding
-- categories and one evidence type.
--
-- Additive: the check constraints on risk_findings.category and
-- risk_evidence.evidence_type gain values; nothing existing is removed.
-- - suspicious_delegation: sharing a credential with another agent, or
--   delegating to / orchestrating an agent that is not registered,
--   suspended or retired (evidence: the agent_relationships row).
-- - unapproved_tool_use: tools used outside the contract's allowed tools
--   (SHOULD vs DID; evidence: the runtime event).

alter table risk_findings drop constraint risk_findings_category_check;
alter table risk_findings add constraint risk_findings_category_check check (category in (
  'excessive_access', 'unauthorized_resource', 'unauthorized_action', 'sensitive_data_violation',
  'behavioral_deviation', 'identity_anomaly', 'ownership_violation', 'lifecycle_violation', 'governance_drift',
  'suspicious_delegation', 'unapproved_tool_use'
));

alter table risk_evidence drop constraint risk_evidence_evidence_type_check;
alter table risk_evidence add constraint risk_evidence_evidence_type_check check (evidence_type in (
  'access_grant', 'runtime_event', 'policy_evaluation', 'ownership_fact', 'lifecycle_event', 'governance_baseline',
  'agent_relationship'
));
