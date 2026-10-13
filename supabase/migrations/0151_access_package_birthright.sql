-- IDENTITY-P0-18 / ACCESS-P0-20 (owner decision, 13 October 2026): birthright
-- access packages. A package marked birthright is assigned automatically to
-- a person who joins, is rehired or moves and is eligible for it; the
-- assignment is provisioned and verified like any other.
--
-- Marking a package birthright is the approval (non-negotiable #15's
-- explicitly approved automation path), so it needs two administrators:
-- one asks (birthright_status 'pending'), someone else approves ('on').
-- The database refuses 'on' without a different approver. A later change
-- to the package's contents or eligibility sends it back to 'pending'
-- (the service does that), so nothing reaches joiners unapproved.
-- Turning it off needs one person.

alter table access_packages
  add column birthright_status text not null default 'off' check (birthright_status in ('off', 'pending', 'on')),
  add column birthright_requested_by uuid references users(id) on delete set null,
  add column birthright_approved_by uuid references users(id) on delete set null,
  add column birthright_approved_at timestamptz,
  add constraint access_packages_birthright_four_eyes check (
    birthright_status <> 'on'
    or (birthright_approved_by is not null and birthright_approved_at is not null and birthright_approved_by is distinct from birthright_requested_by)
  );

create index access_packages_birthright_idx on access_packages (tenant_id) where birthright_status = 'on';
create index access_packages_birthright_requested_by_idx on access_packages (birthright_requested_by) where birthright_requested_by is not null;
create index access_packages_birthright_approved_by_idx on access_packages (birthright_approved_by) where birthright_approved_by is not null;

-- A birthright assignment has no request, like a direct one.
alter table access_package_assignments drop constraint access_package_assignments_source_check;
alter table access_package_assignments add constraint access_package_assignments_source_check check (source in ('request', 'direct', 'birthright'));
