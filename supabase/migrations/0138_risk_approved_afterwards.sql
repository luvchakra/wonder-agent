-- Risk Agent — rogue access approved afterwards is its own resolution (WID-H04).
-- Owner: Risk Agent (risk_findings). See docs/design/ownership-map.md
-- before modifying.
--
-- A rogue-access finding closes when the access is no longer rogue. That
-- happens in two different ways, and the record now says which:
-- 'verified_fixed' when the access was removed, 'approved_afterwards' when
-- it is still there because an approval came after it appeared (the
-- approving request is linked as evidence). Set only by the system.
--
-- Additive only: the resolution list and the evidence types each grow by one value.

alter table risk_findings drop constraint risk_findings_resolution_type_check;
alter table risk_findings add constraint risk_findings_resolution_type_check
  check (resolution_type in ('verified_fixed', 'accepted_risk', 'false_positive', 'approved_afterwards'));

-- The approving request is the finding's evidence: a new evidence type.
alter table risk_evidence drop constraint risk_evidence_evidence_type_check;
alter table risk_evidence add constraint risk_evidence_evidence_type_check check (evidence_type in (
  'access_grant', 'runtime_event', 'policy_evaluation', 'ownership_fact', 'lifecycle_event', 'governance_baseline',
  'agent_relationship', 'access_request'
));
