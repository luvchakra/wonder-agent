-- Access Agent — why a removal task exists, and when it was escalated (WID-C02).
-- Owner: Access Agent (access_fulfilment_tasks). See
-- docs/design/ownership-map.md before modifying.
--
-- 1. access_fulfilment_tasks.reason: why a removal was opened when no
--    request asked for it: 'expired' (time-bound access reached its end
--    date) or 'leaver' (the person left: one removal per grant they held).
--    Null for every other task, which carries its request.
-- 2. access_fulfilment_tasks.escalated_at: when an overdue removal or
--    disable was escalated to the organization's access managers (once).
--
-- Additive only: two nullable columns.

alter table access_fulfilment_tasks
  add column reason text check (reason is null or reason in ('expired', 'leaver')),
  add column escalated_at timestamptz;
