-- OPERATIONS extension for IDENTITY-P0-18 (2026-09-26): a 'lifecycle_task'
-- notification, sent to a person's manager when a joiner, mover, leaver or
-- rehire opens governed work for them. Additive: both type checks from
-- 0066 are widened; no value is removed. Recorded in the Operations audit.

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required', 'lifecycle_task'
));

alter table notification_preferences drop constraint notification_preferences_type_check;
alter table notification_preferences add constraint notification_preferences_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required', 'lifecycle_task'
));
