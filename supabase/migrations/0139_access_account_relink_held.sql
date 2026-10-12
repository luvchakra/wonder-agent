-- Access Agent — accounts kept with their person when a match moved (WID-H01).
-- Owner: Access Agent (account_reconciliation_runs). See
-- docs/design/ownership-map.md before modifying.
--
-- An account already linked to a person stays with them when a later run
-- would match it to someone else (a reassigned email, a reused username).
-- relink_held counts those accounts per run, so the connection page shows
-- them; which ones they are is in the run's audit event. A person relinks
-- an account by hand if it really changed hands.
--
-- Additive only: one column with a default.

alter table account_reconciliation_runs add column relink_held integer not null default 0;
