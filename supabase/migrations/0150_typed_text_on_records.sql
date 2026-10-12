-- Access Agent + Identity Agent — WID-H07 (owner decision 12 October 2026):
-- typed text stays out of audit records. The audit row keeps a fingerprint
-- of the text; the words stay on the record they belong to, where erasure
-- can reach them. Two kinds of typed text had no home but the audit row:
--
-- applications.lifecycle_note: the reason given for suspending, retiring or
-- resuming an application (the latest one; earlier ones are fingerprints in
-- the audit trail).
-- agent_identities.link_basis: why an identity was linked to an agent.
--
-- Additive only: two nullable columns.

alter table applications
  add column lifecycle_note text check (lifecycle_note is null or char_length(lifecycle_note) <= 2000);

alter table agent_identities
  add column link_basis text check (link_basis is null or char_length(link_basis) <= 500);
