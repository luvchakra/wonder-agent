-- Integration Agent — INTEGRATION-P0-13 (decision D3, approved 2026-10-12):
-- a sync started to verify a connector write.
-- Owner: Integration Agent. See docs/design/ownership-map.md before
-- modifying.
--
-- After a connector removes access or disables an account, WonderID reads
-- the system again rather than trusting the write's own answer: the next
-- reconciliation closes the task as verified only when the change is
-- really there. That run is recorded as trigger 'verification', neither a
-- person's "Sync now" nor a schedule.
--
-- Additive only.

alter table integration_sync_jobs drop constraint integration_sync_jobs_trigger_check;
alter table integration_sync_jobs add constraint integration_sync_jobs_trigger_check
  check (trigger in ('manual', 'scheduled', 'verification'));
