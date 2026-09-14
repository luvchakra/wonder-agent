-- Risk Agent — RISK-P0-03.5 follow-up to 0044.
-- Owner: Risk Agent. See docs/design/ownership-map.md before modifying.

-- 0044 added the `false_positive` status value and its `expires_at` column
-- but missed that `risk_findings_resolution_type_check` (predates 0044,
-- defined alongside `resolution_type`/`resolution_reason` in the original
-- RISK-P0-03.3 migration) only allowed 'verified_fixed'/'accepted_risk' —
-- caught by live verification against the FinanceBot fixture tenant before
-- this was ever shipped to `resolveFinding()`. Additive, per CLAUDE.md §13.
alter table risk_findings drop constraint risk_findings_resolution_type_check;
alter table risk_findings add constraint risk_findings_resolution_type_check
  check (resolution_type in ('verified_fixed', 'accepted_risk', 'false_positive'));
