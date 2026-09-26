-- INTEGRATION-P0-09 (2026-09-26): the pipeline's "stage" step. A preview
-- run correlates and plans exactly like a real one (creates, matches,
-- ambiguous records, leavers, the leaver guard) and records the plan, but
-- changes no identity, link or pending match. Additive, default false.
alter table identity_reconciliation_runs add column dry_run boolean not null default false;
