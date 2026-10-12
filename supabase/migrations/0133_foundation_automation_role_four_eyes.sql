-- Foundation Agent — four-eyes on role changes to automation credentials
-- (WID-H06, owner decision 2026-10-12).
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.
--
-- A credential's power is its roles. Giving a role to an approved
-- credential puts it back to pending (it stops working) until another
-- administrator approves; the person who gave the role cannot approve it,
-- here as for the credential's creator. Additive only.

alter table automation_credentials
  add column changed_by uuid references users (id);

alter table automation_credentials
  add constraint automation_credentials_change_four_eyes
  check (approved_by is null or changed_by is null or approved_by <> changed_by);

create index automation_credentials_changed_by_idx on automation_credentials (changed_by) where changed_by is not null;
