-- Foundation Agent — FOUNDATION-P0-29 Tamper-evident, append-only audit
-- trail (2026-10-01, explicit user request: SOX and financial compliance,
-- IT security best practice). Owner: Foundation Agent.
--
-- Before this migration audit_logs had no client write policy (0005), but
-- any service-role caller could still UPDATE or DELETE a row, and nothing
-- would show it. SOX ITGC (and PCI DSS 10.3, ISO 27001 A.8.15, DPDP Rule
-- 8) expect audit evidence to be protected from modification. Now:
--
-- 1. Append-only. UPDATE is refused for every role, the service role
--    included. DELETE is refused except (a) by purge_audit_logs(), the
--    retention purge, which never touches the last 365 days or anything
--    under a legal hold and records a checkpoint; and (b) the cascade of a
--    whole tenant's hard deletion (the tenant row is already gone by then).
-- 2. Hash-chained per tenant. Each row stores chain_seq, prev_hash and
--    row_hash = sha256(prev_hash | the row's fields). A changed, removed
--    or reordered row breaks the chain; verify_audit_chain() finds where.
--    Writes per tenant are serialised with a transaction advisory lock so
--    the chain has no forks.
-- 3. platform_audit_logs is append-only too (its tenant_id may still be
--    nulled by a tenant's hard deletion, the existing FK behaviour).
--
-- A database superuser can still disable triggers; that is outside what an
-- application control can prevent and is covered by Supabase's own access
-- controls and logging (documented in docs/security/SECURITY-CONTROLS.md).

alter table audit_logs
  add column chain_seq bigint,
  add column prev_hash text,
  add column row_hash text;

create or replace function audit_row_hash(p_prev text, r audit_logs)
returns text
language sql
stable
set search_path = public
as $$
  select encode(sha256(convert_to(concat_ws('|',
    coalesce(p_prev, ''),
    r.tenant_id::text,
    r.chain_seq::text,
    coalesce(r.actor_id::text, ''),
    r.actor_type,
    r.action,
    r.object_type,
    r.object_id,
    r.outcome,
    r.metadata::text,
    r.correlation_id::text,
    to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ), 'UTF8')), 'hex');
$$;

revoke execute on function audit_row_hash(text, audit_logs) from public, anon, authenticated;

-- Backfill the chain for existing rows, oldest first, per tenant.
do $$
declare
  t uuid;
  r audit_logs;
  prev text;
  h text;
  seq bigint;
begin
  for t in select distinct tenant_id from audit_logs loop
    prev := null;
    seq := 0;
    for r in select * from audit_logs where tenant_id = t order by created_at, id loop
      seq := seq + 1;
      r.chain_seq := seq;
      h := audit_row_hash(prev, r);
      update audit_logs set chain_seq = seq, prev_hash = prev, row_hash = h where id = r.id;
      prev := h;
    end loop;
  end loop;
end $$;

alter table audit_logs
  alter column chain_seq set not null,
  alter column row_hash set not null;

create unique index audit_logs_tenant_chain_idx on audit_logs (tenant_id, chain_seq desc);

-- Where the chain resumes after a retention purge.
create table audit_log_purges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  up_to_seq bigint not null,
  last_hash text not null,
  purged_count bigint not null,
  purged_before timestamptz not null,
  purged_at timestamptz not null default now()
);

create index audit_log_purges_tenant_idx on audit_log_purges (tenant_id, up_to_seq desc);
alter table audit_log_purges enable row level security;
create policy audit_log_purges_select on audit_log_purges for select
  using (tenant_id in (select current_tenant_ids()));

create or replace function audit_logs_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
  v_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('audit_logs:' || new.tenant_id::text, 0));
  select chain_seq, row_hash into v_seq, v_hash
    from audit_logs where tenant_id = new.tenant_id order by chain_seq desc limit 1;
  if v_seq is null then
    select up_to_seq, last_hash into v_seq, v_hash
      from audit_log_purges where tenant_id = new.tenant_id order by up_to_seq desc limit 1;
  end if;
  new.created_at := coalesce(new.created_at, now());
  new.chain_seq := coalesce(v_seq, 0) + 1;
  new.prev_hash := v_hash;
  new.row_hash := audit_row_hash(v_hash, new);
  return new;
end;
$$;

revoke execute on function audit_logs_chain() from public, anon, authenticated;
create trigger audit_logs_chain before insert on audit_logs
  for each row execute function audit_logs_chain();

create or replace function audit_logs_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_logs is append-only: rows cannot be changed' using errcode = '42501';
  end if;
  if coalesce(current_setting('wonderid.audit_purge', true), '') = 'on' then
    return old;
  end if;
  if not exists (select 1 from tenants where id = old.tenant_id) then
    return old;
  end if;
  raise exception 'audit_logs is append-only: rows are removed only by the retention purge' using errcode = '42501';
end;
$$;

revoke execute on function audit_logs_append_only() from public, anon, authenticated;
create trigger audit_logs_append_only before update or delete on audit_logs
  for each row execute function audit_logs_append_only();

-- The retention purge (Compliance Agent's retention sweep calls it). Only
-- a contiguous oldest prefix of the chain is removed, never the last 365
-- days (DPDP Rules 2025 Rule 8(3)), never under an active legal hold.
create or replace function purge_audit_logs(p_tenant uuid, p_before timestamptz)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cut bigint;
  v_hash text;
  v_count bigint;
begin
  if p_before > now() - interval '365 days' then
    raise exception 'audit logs are kept for at least 365 days' using errcode = '22023';
  end if;
  if exists (select 1 from privacy_legal_holds
              where tenant_id = p_tenant and released_at is null and 'audit_logs' = any (data_categories)) then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('audit_logs:' || p_tenant::text, 0));
  -- The cut is just before the first row that must be kept.
  select coalesce(
           (select min(chain_seq) - 1 from audit_logs where tenant_id = p_tenant and created_at >= p_before),
           (select max(chain_seq) from audit_logs where tenant_id = p_tenant))
    into v_cut;
  if v_cut is null or v_cut < coalesce((select min(chain_seq) from audit_logs where tenant_id = p_tenant), v_cut + 1) then
    return 0;
  end if;
  select row_hash into v_hash from audit_logs where tenant_id = p_tenant and chain_seq = v_cut;
  perform set_config('wonderid.audit_purge', 'on', true);
  delete from audit_logs where tenant_id = p_tenant and chain_seq <= v_cut;
  get diagnostics v_count = row_count;
  perform set_config('wonderid.audit_purge', 'off', true);
  insert into audit_log_purges (tenant_id, up_to_seq, last_hash, purged_count, purged_before)
  values (p_tenant, v_cut, v_hash, v_count, p_before);
  return v_count;
end;
$$;

revoke execute on function purge_audit_logs(uuid, timestamptz) from public, anon, authenticated;
grant execute on function purge_audit_logs(uuid, timestamptz) to service_role;

-- Walks a tenant's chain and reports the first break, if any.
create or replace function verify_audit_chain(p_tenant uuid)
returns table (checked bigint, first_seq bigint, last_seq bigint, broken_at_seq bigint, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r audit_logs;
  v_prev text;
  v_expected_seq bigint;
  v_checked bigint := 0;
  v_first bigint;
  v_last bigint;
begin
  select up_to_seq, last_hash into v_expected_seq, v_prev
    from audit_log_purges where tenant_id = p_tenant order by up_to_seq desc limit 1;
  v_expected_seq := coalesce(v_expected_seq, 0) + 1;
  for r in select * from audit_logs where tenant_id = p_tenant order by chain_seq loop
    v_checked := v_checked + 1;
    v_first := coalesce(v_first, r.chain_seq);
    v_last := r.chain_seq;
    if r.chain_seq <> v_expected_seq then
      return query select v_checked, v_first, v_last, r.chain_seq, 'sequence gap: expected ' || v_expected_seq || ', found ' || r.chain_seq;
      return;
    end if;
    if r.prev_hash is distinct from v_prev then
      return query select v_checked, v_first, v_last, r.chain_seq, 'previous-hash link does not match';
      return;
    end if;
    if r.row_hash <> audit_row_hash(r.prev_hash, r) then
      return query select v_checked, v_first, v_last, r.chain_seq, 'row content does not match its hash';
      return;
    end if;
    v_prev := r.row_hash;
    v_expected_seq := v_expected_seq + 1;
  end loop;
  return query select v_checked, v_first, v_last, null::bigint, null::text;
end;
$$;

revoke execute on function verify_audit_chain(uuid) from public, anon, authenticated;
grant execute on function verify_audit_chain(uuid) to service_role;

-- platform_audit_logs: append-only; only the FK's own "set null" on a
-- tenant's hard deletion may touch a row.
create or replace function platform_audit_logs_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.tenant_id is null and old.tenant_id is not null
     and not exists (select 1 from tenants where id = old.tenant_id)
     and (new.id, new.actor_id, new.action, new.old_value, new.new_value, new.ip_address, new.user_agent, new.result, new.created_at)
         is not distinct from (old.id, old.actor_id, old.action, old.old_value, old.new_value, old.ip_address, old.user_agent, old.result, old.created_at) then
    return new;
  end if;
  raise exception 'platform_audit_logs is append-only' using errcode = '42501';
end;
$$;

revoke execute on function platform_audit_logs_append_only() from public, anon, authenticated;
create trigger platform_audit_logs_append_only before update or delete on platform_audit_logs
  for each row execute function platform_audit_logs_append_only();
