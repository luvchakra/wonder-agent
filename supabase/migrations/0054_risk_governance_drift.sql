-- Risk Agent — RISK-P0-04 (Governance Drift detection)
-- Owner: Risk Agent. See docs/design/ownership-map.md before modifying.

-- New deterministic finding category, additive to the existing check
-- constraint (never a breaking rename of already-Done values), matching
-- the pattern migration 0044 already established for severity/status.
alter table risk_findings drop constraint risk_findings_category_check;
alter table risk_findings add constraint risk_findings_category_check
  check (category in (
    'excessive_access','unauthorized_resource','unauthorized_action',
    'sensitive_data_violation','behavioral_deviation','identity_anomaly',
    'ownership_violation','lifecycle_violation','governance_drift'
  ));

-- Governance-drift evidence (contract-version diff facts: purpose/autonomy/
-- allowed-tools/approved-actions changed, an owner added, or an IAM
-- identity linked, each since the agent's last APPROVED transition) does
-- not fit any existing evidence_type value — 'ownership_fact' is reserved
-- for Identity's own ownership-issue facts, 'lifecycle_event' for an
-- actual agent_lifecycle_events row. One new, generic value covers all of
-- these rather than proliferating a narrow type per sub-signal.
-- ('access_grant', the existing type, already covers this category's
-- "access expanded since approval" sub-signal — no new type needed there.)
alter table risk_evidence drop constraint risk_evidence_evidence_type_check;
alter table risk_evidence add constraint risk_evidence_evidence_type_check
  check (evidence_type in (
    'access_grant','runtime_event','policy_evaluation','ownership_fact',
    'lifecycle_event','governance_baseline'
  ));
