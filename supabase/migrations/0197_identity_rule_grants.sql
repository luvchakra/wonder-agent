-- Identity Agent — IDENTITY-P0-21: identity rules that add a person to a
-- group or assign an access package (design §5.2.1, effect catalogue
-- "Identity" and "Access"). Owner decision 2026-10-17: per rule, the grant
-- either waits for a person's approval or applies automatically. A rule is
-- always published under four-eyes, which is the approved automation path
-- for the automatic case (NN #15).
--
-- Additive:
-- - identity_lifecycle_tasks gains the type 'rule_grant': a grant waiting
--   for approval. It names its rule like a 'rule_task', and its detail says
--   what it grants. Approving it makes the grant; rejecting it needs a
--   reason. The existing unique index keeps one open task per rule per
--   identity;
-- - access_package_assignments gains the source 'rule'.

alter table identity_lifecycle_tasks drop constraint identity_lifecycle_tasks_task_type_check;
alter table identity_lifecycle_tasks add constraint identity_lifecycle_tasks_task_type_check
  check (task_type in ('request_baseline_access', 'review_access', 'transfer_ownership', 'revoke_access', 'disable_sign_in', 'rule_task', 'rule_grant'));

alter table identity_lifecycle_tasks drop constraint identity_lifecycle_tasks_origin_check;
alter table identity_lifecycle_tasks add constraint identity_lifecycle_tasks_origin_check
  check (case when task_type in ('rule_task', 'rule_grant') then rule_id is not null else event_id is not null end);

alter table access_package_assignments drop constraint access_package_assignments_source_check;
alter table access_package_assignments add constraint access_package_assignments_source_check
  check (source in ('request', 'direct', 'birthright', 'rule'));
