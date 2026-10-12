-- Access Agent — WID-H01 (owner decision 12 October 2026): an account
-- unlinked from a person goes back for matching.
--
-- unlinked_identity_id: the person an administrator unlinked the account
-- from. Reconciliation matches the account afresh, but never to that
-- person by itself; linking it by hand clears it.
--
-- rematch_requested_at: set when a source record's unlink restored a
-- person's email, username or name, the values accounts match on. The next
-- reconciliation matches the person's automatically matched accounts
-- afresh instead of keeping them with the person (the WID-H01 hold), then
-- clears it.
--
-- Additive only: two nullable columns.

alter table accounts
  add column unlinked_identity_id uuid,
  add column rematch_requested_at timestamptz,
  add constraint accounts_unlinked_identity_fkey
    foreign key (unlinked_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (unlinked_identity_id);

create index accounts_unlinked_identity_fk_idx on accounts (unlinked_identity_id, tenant_id);
