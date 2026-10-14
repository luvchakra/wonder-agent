-- ACCESS-P0-33 part 2 (design §5.2.1, §5.4): entitlement classification
-- rules. An imported application brings thousands of entitlements with no
-- classification; a rule matches them (name, type, application, current
-- values) and sets their privilege level, data classification, type,
-- requestable or SOX-relevant flag. Evaluated by Operations' shared rule
-- runtime (D12); the table stays with Access, which owns its subject.
--
-- Same shape as Identity's lifecycle_rules (0166): a working copy and the
-- published copy that runs; four-eyes publishing (the approver is never the
-- person who asked; published_by is cleared by a new request, the version
-- table keeps every approver); a new rule starts report-only; every publish
-- is an append-only version. Members read; the Access service writes.
--
-- rule_runs (0167) accepts this table's runs too (additive widening).

create table entitlement_classification_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  trigger_type text not null check (trigger_type in ('entitlement.imported', 'entitlement.changed')),
  scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
  condition text not null default 'true' check (char_length(condition) <= 4000),
  effects jsonb not null default '[]'::jsonb check (jsonb_typeof(effects) = 'array'),
  mode text not null default 'report_only' check (mode in ('report_only', 'enforce')),
  priority integer not null default 100 check (priority between 0 and 100000),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  published jsonb check (published is null or jsonb_typeof(published) = 'object'),
  published_version integer not null default 0 check (published_version >= 0),
  published_by uuid references users(id) on delete set null,
  published_at timestamptz,
  publish_requested_by uuid references users(id) on delete set null,
  publish_requested_at timestamptz,
  last_simulated_at timestamptz,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  check ((status = 'published') = (published is not null and published_version > 0) or status = 'retired'),
  check (published_by is null or publish_requested_by is null or published_by is distinct from publish_requested_by)
);

create unique index entitlement_classification_rules_name_key on entitlement_classification_rules (tenant_id, lower(name));
create index entitlement_classification_rules_live_idx on entitlement_classification_rules (tenant_id, trigger_type) where status = 'published';
create index entitlement_classification_rules_published_by_idx on entitlement_classification_rules (published_by) where published_by is not null;
create index entitlement_classification_rules_publish_requested_by_idx on entitlement_classification_rules (publish_requested_by) where publish_requested_by is not null;
create index entitlement_classification_rules_created_by_idx on entitlement_classification_rules (created_by) where created_by is not null;
create index entitlement_classification_rules_updated_by_idx on entitlement_classification_rules (updated_by) where updated_by is not null;

alter table entitlement_classification_rules enable row level security;
create policy entitlement_classification_rules_select on entitlement_classification_rules for select using (tenant_id in (select current_tenant_ids()));

create table entitlement_classification_rule_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  rule_id uuid not null,
  version integer not null check (version > 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  requested_by uuid references users(id) on delete set null,
  approved_by uuid references users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (rule_id, version),
  foreign key (rule_id, tenant_id) references entitlement_classification_rules (id, tenant_id) on delete cascade,
  check (approved_by is null or requested_by is null or approved_by is distinct from requested_by)
);

create index entitlement_classification_rule_versions_tenant_idx on entitlement_classification_rule_versions (tenant_id, rule_id);
create index entitlement_classification_rule_versions_requested_by_idx on entitlement_classification_rule_versions (requested_by) where requested_by is not null;
create index entitlement_classification_rule_versions_approved_by_idx on entitlement_classification_rule_versions (approved_by) where approved_by is not null;

alter table entitlement_classification_rule_versions enable row level security;
create policy entitlement_classification_rule_versions_select on entitlement_classification_rule_versions for select using (tenant_id in (select current_tenant_ids()));

create or replace function entitlement_classification_rule_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'entitlement_classification_rule_versions are append-only';
end;
$$;
revoke execute on function entitlement_classification_rule_versions_immutable() from public, anon, authenticated;
create trigger entitlement_classification_rule_versions_immutable before update on entitlement_classification_rule_versions
  for each row execute function entitlement_classification_rule_versions_immutable();

alter table rule_runs drop constraint rule_runs_rule_table_check;
alter table rule_runs add constraint rule_runs_rule_table_check check (rule_table in ('lifecycle_rules', 'entitlement_classification_rules'));
