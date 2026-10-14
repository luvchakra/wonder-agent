-- Compliance Agent — COMPLIANCE-P0-10 part 2: three more decisions on a
-- review of a person's access or WonderID role.
-- - defer: the item stays open with a later due date;
-- - escalate: the item goes to whoever launched the campaign;
-- - exception: the access is kept until a date, then removed (Access's
--   time-bound path for an application grant; the role's own end date for
--   a WonderID role).
--
-- Additive: the decision list gains the three values, and a decision
-- gains `until`, set exactly for defer and exception.

alter table certification_decisions drop constraint certification_decisions_decision_check;
alter table certification_decisions add constraint certification_decisions_decision_check
  check (decision in ('approve', 'revoke', 'modify', 'delegate', 'request_information', 'defer', 'escalate', 'exception'));

alter table certification_decisions add column until timestamptz;
alter table certification_decisions
  add constraint certification_decisions_until_check check ((decision in ('defer', 'exception')) = (until is not null));
