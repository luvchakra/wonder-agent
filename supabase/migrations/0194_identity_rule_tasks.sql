-- Identity Agent — IDENTITY-P0-21: the "open a task" effect of identity
-- rules (design §5.2.1, effect catalogue "Work"). A published rule can open
-- a task about the identity, for its manager or for identity
-- administrators. It grants nothing.
--
-- Additive:
-- - identity_lifecycle_tasks gains rule_id and rule_version, and the type
--   'rule_task';
-- - event_id becomes optional: a rule task may come from a trigger that
--   records no lifecycle event (created, imported, attribute changed). Every
--   other task still has its event;
-- - one open task per rule per identity, so a rule that fires again does
--   not pile up duplicates.

alter table identity_lifecycle_tasks alter column event_id drop not null;
alter table identity_lifecycle_tasks
  add column rule_id uuid,
  add column rule_version integer;
alter table identity_lifecycle_tasks
  add constraint identity_lifecycle_tasks_rule_same_tenant foreign key (rule_id, tenant_id) references lifecycle_rules (id, tenant_id);

alter table identity_lifecycle_tasks drop constraint identity_lifecycle_tasks_task_type_check;
alter table identity_lifecycle_tasks add constraint identity_lifecycle_tasks_task_type_check
  check (task_type in ('request_baseline_access', 'review_access', 'transfer_ownership', 'revoke_access', 'disable_sign_in', 'rule_task'));

-- A rule task names its rule; every other task names its lifecycle event.
alter table identity_lifecycle_tasks add constraint identity_lifecycle_tasks_origin_check
  check (case when task_type = 'rule_task' then rule_id is not null else event_id is not null end);

create unique index identity_lifecycle_tasks_rule_open_idx on identity_lifecycle_tasks (tenant_id, identity_id, rule_id)
  where status = 'open' and rule_id is not null;
