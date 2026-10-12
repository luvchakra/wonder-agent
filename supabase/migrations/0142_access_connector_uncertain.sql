-- Access Agent — WID-H02: a connector change whose outcome is unclear.
--
-- When a connector's change fails in a way that may have reached the
-- system (a timeout, a dropped connection, 408 or 5xx) and the change is
-- not declared repeatable, it is not sent again. WonderID reads the system
-- instead (a verification sync): reconciliation closes the task if the
-- change is there. connector_uncertain_at is when that happened; the
-- task's owner may try the connector again only once a read of the
-- connection that started after it has finished.
--
-- Additive; no policy change (the table has no client write policy, 0122).

alter table access_fulfilment_tasks add column connector_uncertain_at timestamptz;

comment on column access_fulfilment_tasks.connector_uncertain_at is
  'WID-H02: when a connector change ended with an unclear outcome; a retry waits for a read of the system started after it.';
