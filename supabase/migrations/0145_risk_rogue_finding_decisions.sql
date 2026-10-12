-- Risk Agent — WID-H04 (owner decision 12 October 2026): an accepted
-- exception and a false positive for rogue-access findings on accounts.
--
-- decided_by / decided_at / decision_reason: who closed or excepted the
-- finding, when, and why. Someone other than the account's owner decides
-- (checked in the service, where the person behind a user is known).
-- exception_until: an accepted exception ends at most 90 days after it was
-- decided; the finding reopens then. Both are kept on the finding and in
-- the audit trail.
--
-- Additive; no policy change (risk_findings has no client write policy,
-- 0034).

alter table risk_findings
  add column decided_by uuid references users(id),
  add column decided_at timestamptz,
  add column decision_reason text check (decision_reason is null or char_length(decision_reason) between 1 and 1000),
  add column exception_until timestamptz;

alter table risk_findings add constraint risk_findings_rogue_exception_window check (
  category <> 'rogue_access' or status <> 'exception'
  or (exception_until is not null and decided_at is not null and exception_until <= decided_at + interval '90 days')
);

create index risk_findings_decided_by_idx on risk_findings (decided_by);
create index risk_findings_exception_until_idx on risk_findings (tenant_id, exception_until) where status = 'exception';
