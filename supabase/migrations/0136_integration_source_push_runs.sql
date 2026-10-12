-- Integration Agent — one reconciliation at a time for pushed identities
-- (INTEGRATION-P0-22 slice 3: users received over SCIM).
-- Owner: Integration Agent (identity_sources). See
-- docs/design/ownership-map.md before modifying.
--
-- Each user a system pushes over SCIM asks the identity sources that read
-- the connection to run. Two runs of one source at once could create the
-- same person twice, so pushes coalesce:
-- 1. identity_sources.run_requested_at: the last time a push asked for a run.
-- 2. identity_sources.run_claimed_at: set by the one worker running the
--    source; others only record their request, and the worker runs again
--    while requests arrived after its last start. A claim older than ten
--    minutes is taken as abandoned.
--
-- Additive only: two nullable columns.

alter table identity_sources
  add column run_requested_at timestamptz,
  add column run_claimed_at timestamptz;
