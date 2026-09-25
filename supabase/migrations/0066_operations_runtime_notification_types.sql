-- OPERATIONS-P0-08 (master stories P0-41) — runtime and approval
-- notifications raised from Runtime Gateway decisions.
--
-- Additive only: the two type check constraints from 0048 are widened with
-- 'runtime_alert' (a request denied in ENFORCE mode) and
-- 'approval_required' (a request held for approval in ENFORCE mode). No
-- existing value is removed, so every row already stored stays valid. RLS
-- and policies on both tables are unchanged.

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required'
));

alter table notification_preferences drop constraint notification_preferences_type_check;
alter table notification_preferences add constraint notification_preferences_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required'
));

-- The throttle lookup (notifications for this tenant, type and agent in
-- the last few minutes) is served by this index rather than a scan.
create index if not exists notifications_tenant_type_ref_created_idx
  on notifications (tenant_id, type, reference_id, created_at desc);
