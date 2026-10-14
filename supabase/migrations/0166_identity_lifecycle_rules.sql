-- IDENTITY-P0-21 (design §5.2.1, decision D12): the organization's identity
-- rules. One table for attribute rules now and lifecycle rules later
-- (IDENTITY-P0-18 finish), evaluated by Operations' shared rule runtime
-- (modules/operations/rules); the table stays with Identity, which owns its
-- subject.
--
-- A rule has a working definition (what people edit) and, once published, a
-- frozen copy that is what runs (`published`, `published_version`), so an
-- edit never changes behaviour until it is published again. Publishing is
-- four-eyes: one person asks, someone else approves; the database refuses an
-- approval by the person who asked. A new rule starts in report-only mode.
-- Every publish is a row in lifecycle_rule_versions, which nobody can change.
--
-- Members read rules (they explain values on identity pages); every write
-- goes through the service role in the Identity service, filtered by tenant.

create table lifecycle_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null default 'attribute' check (kind in ('attribute', 'lifecycle')),
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  trigger_type text not null check (char_length(trigger_type) between 1 and 100),
  trigger_attribute text check (trigger_attribute is null or char_length(trigger_attribute) <= 100),
  trigger_source text check (trigger_source is null or char_length(trigger_source) <= 200),
  scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
  condition text not null default 'true' check (char_length(condition) <= 4000),
  effects jsonb not null default '[]'::jsonb check (jsonb_typeof(effects) = 'array'),
  mode text not null default 'report_only' check (mode in ('report_only', 'enforce')),
  priority integer not null default 100 check (priority between 0 and 100000),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  -- What runs: the definition as last published, and its version.
  published jsonb check (published is null or jsonb_typeof(published) = 'object'),
  published_version integer not null default 0 check (published_version >= 0),
  published_by uuid references users(id) on delete set null,
  published_at timestamptz,
  -- A pending publish request (four-eyes).
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

create unique index lifecycle_rules_name_key on lifecycle_rules (tenant_id, lower(name));
create index lifecycle_rules_live_idx on lifecycle_rules (tenant_id, trigger_type) where status = 'published';
create index lifecycle_rules_published_by_idx on lifecycle_rules (published_by) where published_by is not null;
create index lifecycle_rules_publish_requested_by_idx on lifecycle_rules (publish_requested_by) where publish_requested_by is not null;
create index lifecycle_rules_created_by_idx on lifecycle_rules (created_by) where created_by is not null;
create index lifecycle_rules_updated_by_idx on lifecycle_rules (updated_by) where updated_by is not null;

alter table lifecycle_rules enable row level security;
create policy lifecycle_rules_select on lifecycle_rules for select using (tenant_id in (select current_tenant_ids()));

create table lifecycle_rule_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  rule_id uuid not null,
  version integer not null check (version > 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  requested_by uuid references users(id) on delete set null,
  approved_by uuid references users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (rule_id, version),
  foreign key (rule_id, tenant_id) references lifecycle_rules (id, tenant_id) on delete cascade,
  check (approved_by is null or requested_by is null or approved_by is distinct from requested_by)
);

create index lifecycle_rule_versions_tenant_idx on lifecycle_rule_versions (tenant_id, rule_id);
create index lifecycle_rule_versions_requested_by_idx on lifecycle_rule_versions (requested_by) where requested_by is not null;
create index lifecycle_rule_versions_approved_by_idx on lifecycle_rule_versions (approved_by) where approved_by is not null;

alter table lifecycle_rule_versions enable row level security;
create policy lifecycle_rule_versions_select on lifecycle_rule_versions for select using (tenant_id in (select current_tenant_ids()));

-- A published version is evidence: it never changes.
create or replace function lifecycle_rule_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'lifecycle_rule_versions are append-only';
end;
$$;
revoke execute on function lifecycle_rule_versions_immutable() from public, anon, authenticated;
create trigger lifecycle_rule_versions_immutable before update on lifecycle_rule_versions
  for each row execute function lifecycle_rule_versions_immutable();
