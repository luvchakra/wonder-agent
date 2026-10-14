-- Compliance Agent — COMPLIANCE-P0-14 part 1: campaign templates.
-- A template is a saved launch: name, scope, reviewer kind, cadence and how
-- many days reviewers get. Launching from it starts an ordinary campaign.
--
-- Also (CLAUDE.md §19.10; high-risk register, 14 Oct 09:06 IST, Low): the
-- four object tables of #175–#177 get the record provenance columns and
-- trigger they were missing, as does the new table. Same loop as 0115.
--
-- Additive: one new table; four tables gain columns they may lack.

create table certification_campaign_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  scope_type text not null check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access', 'role_assignments')),
  scope jsonb not null default '{}'::jsonb,
  reviewer_kind text not null default 'named' check (reviewer_kind in ('named', 'manager', 'application_owner')),
  reviewer_id uuid,
  cadence text not null default 'one_time' check (cadence in ('one_time', 'periodic', 'event_driven')),
  due_in_days integer check (due_in_days is null or due_in_days between 1 and 365),
  archived_at timestamptz
);
create unique index certification_campaign_templates_name_key on certification_campaign_templates (tenant_id, lower(name)) where archived_at is null;
create index certification_campaign_templates_tenant_idx on certification_campaign_templates (tenant_id);

alter table certification_campaign_templates enable row level security;
create policy certification_campaign_templates_select on certification_campaign_templates
  for select using (tenant_id in (select current_tenant_ids()));
-- Writes go through the Compliance service (compliance.manage), service role, filtered by tenant.

do $$
declare
  t text;
begin
  foreach t in array array[
    'certification_campaign_templates',
    'application_entitlement_types', 'entitlement_classification_rules', 'entitlement_classification_rule_versions',
    'application_onboarding_templates'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'record_provenance: no table %, skipped', t;
      continue;
    end if;
    execute format('alter table %I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table %I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table %I add column if not exists created_by uuid', t);
    execute format('alter table %I add column if not exists updated_by uuid', t);
    if not exists (select 1 from pg_trigger where tgname = 'record_provenance' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger record_provenance before insert or update on %I for each row execute function record_provenance()', t);
    end if;
  end loop;
end;
$$;
