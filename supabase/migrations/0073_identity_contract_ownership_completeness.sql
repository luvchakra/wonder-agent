-- IDENTITY-P0-13 (master stories P0-03/04/06) — contract and ownership
-- completeness.
--
-- Additive only. Every existing row stays valid:
-- - agent_owners.owner_type gains 'escalation_owner' (the UI already
--   offered it but the check rejected it: a live defect) and
--   'delegated_owner'. A delegated owner must record who delegated it and
--   when the delegation expires.
-- - agent_owners gains ownership-review stamps.
-- - agent_contracts gains approved users, approved delegators, allowed
--   environments and an expiry (empty lists mean "not restricted", as for
--   the existing list fields).
-- RLS and policies are unchanged.

alter table agent_owners drop constraint agent_owners_owner_type_check;
alter table agent_owners add constraint agent_owners_owner_type_check check (owner_type in (
  'business_owner', 'technical_owner', 'iam_owner', 'application_owner', 'data_owner',
  'escalation_owner', 'delegated_owner'
));

alter table agent_owners
  add column delegated_by uuid references users(id),
  add column delegation_expires_at timestamptz,
  add column last_reviewed_at timestamptz,
  add column last_reviewed_by uuid references users(id);

alter table agent_owners add constraint agent_owners_delegation_check
  check (owner_type <> 'delegated_owner' or (delegated_by is not null and delegation_expires_at is not null));

alter table agent_contracts
  add column approved_users text[] not null default '{}',
  add column approved_delegators text[] not null default '{}',
  add column allowed_environments text[] not null default '{}'
    check (allowed_environments <@ array['production', 'staging', 'development']::text[]),
  add column expires_at timestamptz;
