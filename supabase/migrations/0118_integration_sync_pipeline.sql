-- Integration Agent — INTEGRATION-P0-19: scheduled import and promotion.
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.
--
-- After a full sync, WonderID now carries the data on by itself: the
-- identity sources that read the connection promote its identities, then
-- each application onboarded on the connection reconciles its accounts.
-- One sync job records the whole chain:
--
-- integration_sync_jobs.pipeline: the steps after the import, in order,
--   each with its status (pending, running, succeeded, partial, failed,
--   skipped), its own run record, counts, and the reason it failed or was
--   skipped. Written by the worker as each step starts and ends.
-- integration_sync_jobs.pipeline_status: none (nothing follows), running,
--   succeeded, partial or failed. A failed step skips the rest and the
--   chain is failed; nothing is reported as succeeded that did not happen.
--
-- Both are on an existing tenant-scoped, RLS-protected table whose SELECT
-- policy already covers them; only the service role writes results. The
-- client INSERT policy now also pins them to their defaults, so a member
-- creating a job can never claim a chain ran.

alter table integration_sync_jobs
  add column pipeline jsonb not null default '[]'::jsonb,
  add column pipeline_status text not null default 'none' check (pipeline_status in ('none', 'running', 'succeeded', 'partial', 'failed'));

alter policy integration_sync_jobs_insert on integration_sync_jobs
  with check (
    tenant_id in (select current_tenant_ids())
    and status = 'queued'
    and started_at is null
    and ended_at is null
    and records_processed = 0
    and records_failed = 0
    and errors = '[]'::jsonb
    and schedule_window is null
    and missing_status = 'none'
    and missing_summary = '{}'::jsonb
    and missing_resolved_by is null
    and missing_resolved_at is null
    and pipeline = '[]'::jsonb
    and pipeline_status = 'none'
  );
