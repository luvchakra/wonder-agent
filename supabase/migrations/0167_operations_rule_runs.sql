-- OPERATIONS-P0-11 (runtime part, decision D12): the automation run log of
-- design §5.2.1. Every evaluation, effect, skip and error of a rule, with the
-- rule version that decided, for every module's rule table (rule_table names
-- it: lifecycle_rules first). Written by the owning module through the
-- service role; read by members of the organization; never changed.

create table rule_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  rule_table text not null check (rule_table in ('lifecycle_rules')),
  rule_id uuid not null,
  rule_version integer not null check (rule_version >= 0),
  subject_type text not null check (char_length(subject_type) between 1 and 50),
  subject_id uuid not null,
  trigger text not null check (char_length(trigger) between 1 and 100),
  mode text not null check (mode in ('report_only', 'enforce')),
  outcome text not null check (outcome in ('applied', 'reported', 'not_matched', 'out_of_scope', 'skipped', 'error')),
  effects jsonb not null default '[]'::jsonb check (jsonb_typeof(effects) = 'array'),
  detail text check (detail is null or char_length(detail) <= 2000),
  correlation_id text check (correlation_id is null or char_length(correlation_id) <= 200),
  created_at timestamptz not null default now()
);

create index rule_runs_rule_idx on rule_runs (tenant_id, rule_id, created_at desc);
create index rule_runs_subject_idx on rule_runs (tenant_id, subject_id, created_at desc);

alter table rule_runs enable row level security;
create policy rule_runs_select on rule_runs for select using (tenant_id in (select current_tenant_ids()));

create or replace function rule_runs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'rule_runs is append-only';
end;
$$;
revoke execute on function rule_runs_append_only() from public, anon, authenticated;
create trigger rule_runs_append_only before update on rule_runs
  for each row execute function rule_runs_append_only();
