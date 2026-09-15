-- Identity Agent — Agent Discovery (fully functional discovery inbox extension)
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.
--
-- Extends the existing agent_duplicate_candidates table (built for
-- IDENTITY-P0-04's registration-time duplicate check) so it can also record
-- a reviewer's direct decision on a Discovery Inbox candidate that has not
-- gone through registration yet: "ignore" (not an agent / not worth
-- tracking) or "link" (correlate to a specific existing agent). This is the
-- same table, not a new one — the discovery spec's own Codebase-Fit
-- Acceptance Gate requires reusing the existing duplicate-candidate
-- workflow for P0 review rather than introducing a parallel
-- discovery_records/discovery_evidence table.
--
-- matched_agent_id becomes optional because an "ignore" decision has no
-- matched agent at all. source_system/source_object_id identify *which*
-- external discovery object the decision applies to (the same
-- integration-id + external-id pair buildDiscoveryInbox() already uses as
-- its natural key), so a repeated discovery run can look up "was this one
-- already decided?" idempotently.

alter table agent_duplicate_candidates
  alter column matched_agent_id drop not null;

alter table agent_duplicate_candidates
  add column source_system text,
  add column source_object_id text,
  add column decision_type text not null default 'duplicate_review'
    check (decision_type in ('duplicate_review', 'ignored', 'linked'));

alter table agent_duplicate_candidates
  drop constraint agent_duplicate_candidates_status_check;

alter table agent_duplicate_candidates
  add constraint agent_duplicate_candidates_status_check
    check (status in ('pending', 'merged', 'confirmed_distinct', 'ignored', 'linked'));

create index agent_duplicate_candidates_source_idx
  on agent_duplicate_candidates (tenant_id, source_system, source_object_id);
