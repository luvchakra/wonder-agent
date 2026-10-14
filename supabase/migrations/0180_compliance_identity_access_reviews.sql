-- COMPLIANCE-P0-10 part 1: access reviews (certification) of people's
-- application access, not only AI agents'. A campaign of scope
-- 'identity_access' has one item per live access grant on an account
-- linked to a non-agent identity (person, contractor, service account),
-- reviewed by the identity's manager, the application's owner, or a named
-- reviewer. A revoke becomes an approved removal request in Access.
--
-- Additive: certification_items gains identity_id and account_id, and
-- agent_id becomes optional (an item is about exactly one agent or one
-- identity); campaigns gain the scope and a reviewer kind.

alter table certification_campaigns drop constraint certification_campaigns_scope_type_check;
alter table certification_campaigns add constraint certification_campaigns_scope_type_check
  check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access'));

alter table certification_campaigns
  add column reviewer_kind text not null default 'named' check (reviewer_kind in ('named', 'manager', 'application_owner'));

alter table certification_items alter column agent_id drop not null;
alter table certification_items
  add column identity_id uuid references identities(id) on delete cascade,
  add column account_id uuid references accounts(id) on delete set null;
alter table certification_items
  add constraint certification_items_subject_check check ((agent_id is null) <> (identity_id is null));

create index certification_items_identity_id_idx on certification_items (identity_id) where identity_id is not null;
create index certification_items_account_id_idx on certification_items (account_id) where account_id is not null;

-- A certified revoke's removal request is recorded on its decision (certification_decisions.remediation_id).
