-- Risk Agent — a finding category for actions that went around the
-- Runtime Gateway (WID-C03).
-- Owner: Risk Agent (risk_findings). See docs/design/ownership-map.md
-- before modifying.
--
-- 'gateway_bypass': an agent that asks the Runtime Gateway before it acts
-- was observed acting with no matching gateway decision, or although the
-- gateway said DENY. Detected deterministically from Runtime's events
-- (modules/risk/signals.ts, gatewayBypass).
--
-- Additive only: the category list grows by one value.

alter table risk_findings drop constraint risk_findings_category_check;
alter table risk_findings add constraint risk_findings_category_check check (category in (
  'excessive_access', 'unauthorized_resource', 'unauthorized_action', 'sensitive_data_violation',
  'behavioral_deviation', 'identity_anomaly', 'ownership_violation', 'lifecycle_violation',
  'governance_drift', 'suspicious_delegation', 'unapproved_tool_use', 'rogue_access', 'gateway_bypass'
));
