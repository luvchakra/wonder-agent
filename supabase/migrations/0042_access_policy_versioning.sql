-- Access Agent — ACCESS-P0-05
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.

alter table policies add column version integer not null default 1;
alter table policies add column priority integer not null default 0;

-- Append-only change history: one row per prior state, written by
-- updatePolicy() before it applies an update. Same tenant-scoping-via-join
-- pattern as policy_rules/policy_exceptions (no tenant_id column of its
-- own). No update/delete policy at all — history must never be edited or
-- removed by a client.
create table policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);

create index policy_versions_policy_id_idx on policy_versions (policy_id);

alter table policy_versions enable row level security;

create policy policy_versions_select on policy_versions
  for select using (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())));
create policy policy_versions_insert on policy_versions
  for insert with check (policy_id in (select id from policies where tenant_id in (select current_tenant_ids())));

-- policy_evaluations gets the policy's version at evaluation time, so a
-- stored evaluation is reproducible against the exact rule set that
-- produced it (the new doc's ACCESS-P0-06 requirement).
alter table policy_evaluations add column policy_version integer not null default 1;
