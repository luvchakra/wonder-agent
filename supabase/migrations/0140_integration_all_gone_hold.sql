-- Integration Agent — a sync that would mark everything of a kind missing is
-- held, whatever the population (WID-H03).
-- Owner: Integration Agent (stage_mark_missing, 0117). See
-- docs/design/ownership-map.md before modifying.
--
-- The mass-missing guard (0117) held a run only for kinds with at least
-- p_min_population (20) objects, so a broken feed in a small organization
-- (an empty file, a filter that matched nothing) could mark every person or
-- account missing at once. Now a run that would mark every present object
-- of a kind missing is held for a person too, at any size. The threshold
-- rule is unchanged; the caller passes a per-kind threshold.
--
-- Same signature, replaced in place; nothing else changes.

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
     and ((v_present >= p_min_population and v_candidates * 100 > v_present * p_threshold_percent)
          -- WID-H03: everything of the kind gone at once is held at any size.
          or (v_present > 0 and v_candidates = v_present)) then
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
