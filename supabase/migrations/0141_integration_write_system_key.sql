-- Integration Agent — WID-H02: the Idempotency-Key the system received.
--
-- connector_write_operations keeps one row per attempt, claimed by its
-- own idempotency_key. Since WID-H02 the key sent to the system is one per
-- task and change, so a retry of the same change sends the same key. This
-- column records which key the system saw, for the audit trail and for
-- reconciling what the system received. Null for rows from before WID-H02
-- (those sent idempotency_key itself).
--
-- Additive; no policy change (the table has no client write policy).

alter table connector_write_operations add column system_key text
  check (system_key is null or system_key ~ '^[A-Za-z0-9._:-]{8,200}$');

comment on column connector_write_operations.system_key is
  'WID-H02: the Idempotency-Key sent to the system (one per task and change); null before WID-H02.';
