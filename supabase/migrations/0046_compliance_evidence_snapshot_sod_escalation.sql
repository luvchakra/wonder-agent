-- Compliance Agent — COMPLIANCE-P0-03, COMPLIANCE-P0-05
-- Owner: Compliance Agent. See docs/design/ownership-map.md before modifying.

-- COMPLIANCE-P0-03 — point-in-time evidence snapshot (agent contract
-- version, the specific access grant, policy version(s), risk/usage at
-- that moment), captured once at population time and again, fresh, at
-- decision time. Both tables already grant client SELECT only / no
-- client-facing write policy at all (migration 0036) — same evidentiary
-- lockdown extends to this new column, no policy change needed.
alter table certification_items add column snapshot jsonb;
alter table certification_decisions add column snapshot jsonb;

-- COMPLIANCE-P0-05 — escalation of overdue pending items. Additive columns
-- on the existing evidentiary table; no new RLS policy needed (writes
-- already go through the service-role client for this table).
alter table certification_items add column escalated_at timestamptz;
alter table certification_items add column escalated_to uuid references users(id);
