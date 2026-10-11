-- Access Agent — ACCESS-P0-32: time-bound access.
-- Owner: Access Agent (access_requests). Operations owns notifications; the
-- type list grows by one value, as 0122 did. See
-- docs/design/ownership-map.md before modifying.
--
-- A request's end date (requested_expiry, capped by its policy since 0092)
-- now has consequences:
--
-- 1. access_requests.request_type gains 'extend': a request to keep access
--    the subject holds for longer. It is approved like any request; on
--    approval the grant's evidence moves to it (access_grants.request_id).
-- 2. access_requests.expiry_reminded_at: when the reminder before the end
--    date went out (once per request).
-- 3. access_requests.expiry_processed_at: when the daily sweep turned the
--    request's live grants into removal work. The sweep only looks at
--    requests without it, and each grant's removal is conditional and has
--    one live task at most (0123), so a re-run changes nothing.
-- 4. notifications / notification_preferences: type 'access_expiring'.
--
-- Additive only: nothing is dropped.

alter table access_requests drop constraint access_requests_request_type_check;
alter table access_requests add constraint access_requests_request_type_check
  check (request_type in ('grant', 'modify', 'remove', 'disable_account', 'extend'));

alter table access_requests
  add column expiry_reminded_at timestamptz,
  add column expiry_processed_at timestamptz;

-- The daily sweeps: approved requests with an end date not yet handled.
create index access_requests_expiry_due_idx on access_requests (requested_expiry)
  where requested_expiry is not null and expiry_processed_at is null and status in ('approved', 'fulfilled');

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required', 'lifecycle_task',
  'billing_alert', 'privacy_deadline', 'fulfilment_task', 'access_expiring'
));
alter table notification_preferences drop constraint notification_preferences_type_check;
alter table notification_preferences add constraint notification_preferences_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required', 'lifecycle_task',
  'billing_alert', 'privacy_deadline', 'fulfilment_task', 'access_expiring'
));
