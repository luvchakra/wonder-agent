-- Integration Agent — INTEGRATION-P0-18: staging reflects the source.
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.
--
-- Until now a sync only upserted into integration_objects and never noticed
-- an object that had gone from the source, so an account removed on the
-- target, or a leaver dropped by an HR feed read through a connection, stayed
-- in staging for ever. This migration lets a sync say so, carefully:
--
-- 1. integration_objects.missing_at_source_at: when a complete full run last
--    found the object gone. Never a delete: the row, its history and anything
--    that refers to it stay. A later run that sees the object again clears
--    the time (the sync's upsert writes null).
-- 2. integration_sync_jobs.mode: full (the default; a connection reads
--    everything it holds), incremental or partial. Only a full run may mark
--    objects missing. The object-page CSV import runs as partial, because a
--    file of five rows says nothing about the rows it leaves out.
-- 3. integration_sync_jobs.missing_status / missing_summary: what the run
--    decided per kind (marked, held for a person, or skipped and why).
-- 4. stage_mark_missing(): the one place the marking happens, atomically, with
--    the mass-missing guard and the rule that a run never marks objects a
--    newer run has seen. Service role only.
--
-- Every column is on an existing tenant-scoped, RLS-protected table; the
-- existing SELECT policies cover them. Clients still cannot write
-- integration_objects at all, and the client INSERT policy on sync jobs now
-- also pins the new result columns to their defaults.

alter table integration_objects add column missing_at_source_at timestamptz;

alter table integration_sync_jobs
  add column mode text not null default 'full' check (mode in ('full', 'incremental', 'partial')),
  add column missing_status text not null default 'none' check (missing_status in ('none', 'applied', 'held', 'approved', 'discarded')),
  add column missing_summary jsonb not null default '{}'::jsonb,
  add column missing_resolved_by uuid references users(id),
  add column missing_resolved_at timestamptz;

create index integration_sync_jobs_missing_held_idx on integration_sync_jobs (tenant_id, integration_id) where missing_status = 'held';
create index integration_sync_jobs_missing_resolved_by_idx on integration_sync_jobs (missing_resolved_by) where missing_resolved_by is not null;

-- A client-created job starts with no missing-at-source result: it can never
-- claim a run was approved or held. Otherwise unchanged from 0111.
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
  );

-- Marks the objects of one kind that a complete full run did not see.
--
-- Candidates: objects of the kind, on the job's own connection and tenant,
-- not already missing, last seen by an earlier run than this one (or never
-- tagged with a run). An object last seen by a run that started after this
-- one is never a candidate, so two overlapping syncs cannot mark what the
-- other saw.
--
-- Guard: when p_threshold_percent is not null, a kind with at least
-- p_min_population present objects whose candidates exceed that share is
-- held (nothing marked; held = true), for a person to approve or discard.
-- p_threshold_percent null applies without the guard (an approved hold).
create or replace function stage_mark_missing(
  p_tenant uuid,
  p_job uuid,
  p_kind text,
  p_threshold_percent integer,
  p_min_population integer default 20
) returns table (candidates integer, present_before integer, marked integer, held boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_integration uuid;
  v_started timestamptz;
  v_candidates integer;
  v_present integer;
  v_marked integer;
begin
  select j.integration_id, j.started_at into v_integration, v_started
    from integration_sync_jobs j
   where j.id = p_job and j.tenant_id = p_tenant;
  if v_integration is null or v_started is null then
    raise exception 'sync job % is not a started job of this tenant', p_job using errcode = 'P0002';
  end if;

  select count(*) filter (where o.sync_job_id is distinct from p_job and (o.sync_job_id is null or earlier.started_at < v_started)),
         count(*)
    into v_candidates, v_present
    from integration_objects o
    left join integration_sync_jobs earlier on earlier.id = o.sync_job_id
   where o.tenant_id = p_tenant
     and o.integration_id = v_integration
     and o.object_type = p_kind
     and o.missing_at_source_at is null;

  if p_threshold_percent is not null
     and v_present >= p_min_population
     and v_candidates * 100 > v_present * p_threshold_percent then
    return query select v_candidates, v_present, 0, true;
    return;
  end if;

  update integration_objects o
     set missing_at_source_at = now()
   where o.tenant_id = p_tenant
     and o.integration_id = v_integration
     and o.object_type = p_kind
     and o.missing_at_source_at is null
     and o.sync_job_id is distinct from p_job
     and (o.sync_job_id is null
          or exists (select 1 from integration_sync_jobs e where e.id = o.sync_job_id and e.started_at < v_started));
  get diagnostics v_marked = row_count;
  return query select v_candidates, v_present, v_marked, false;
end;
$$;

revoke execute on function stage_mark_missing(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function stage_mark_missing(uuid, uuid, text, integer, integer) to service_role;
