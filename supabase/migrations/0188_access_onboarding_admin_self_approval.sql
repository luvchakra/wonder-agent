-- Access Agent — owner decision 2026-10-14 (test feedback item 7): an
-- administrator (TENANT_SUPER_ADMIN) may approve an onboarding they
-- submitted themselves. Everyone else still needs a second person.
--
-- The four-eyes check now allows approver = submitter only when the row is
-- marked self_approved, which the service sets only for an administrator,
-- with a required note, audited as a self-approval. Additive: a new column
-- (false for every existing row) and the check replaced by a wider one.

alter table application_onboardings add column self_approved boolean not null default false;
alter table application_onboardings drop constraint application_onboardings_check;
alter table application_onboardings add constraint application_onboardings_four_eyes
  check (approved_by is null or submitted_by is null or approved_by <> submitted_by or self_approved);
