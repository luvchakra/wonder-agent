-- Platform Agent — WID-H07: audit-log retention defaults (owner decision,
-- 12 October 2026: 1 year on Free and Pro, 3 years on Max, 7 years on
-- Enterprise).
--
-- The purge never removes audit rows younger than 365 days (DPDP Rule
-- 8(3), purge_audit_logs, migration 0104), but the Free and Pro plan
-- defaults said 30 and 90 days. Existing subscriptions are raised to the
-- new default for their plan, never lowered, and a subscription can no
-- longer record less than a year.
--
-- Additive; no policy change (subscriptions has no client write policy).

update subscriptions
set audit_retention_days = greatest(audit_retention_days, case plan when 'max' then 1095 when 'enterprise' then 2555 else 365 end)
where audit_retention_days < case plan when 'max' then 1095 when 'enterprise' then 2555 else 365 end;

alter table subscriptions add constraint subscriptions_audit_retention_floor check (audit_retention_days >= 365);
