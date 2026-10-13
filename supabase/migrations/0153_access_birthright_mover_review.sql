-- WID-H09 (owner decision, 13 October 2026): when a person moves and no
-- longer qualifies for a birthright package they hold, the package goes to
-- a dated review. Their manager (or anyone with access.manage) keeps it, or
-- it is removed when the date passes, through the normal removal path
-- (the package-expiry sweep ends the assignment; held access becomes
-- removal work, confirmed by reconciliation).
--
-- review_due_at: set only on a live birthright assignment under review.
-- review_kept_by / review_kept_at: who kept it after the last review.

alter table access_package_assignments
  add column review_due_at timestamptz,
  add column review_kept_by uuid references users(id) on delete set null,
  add column review_kept_at timestamptz,
  add constraint access_package_assignments_review_birthright check (review_due_at is null or source = 'birthright'),
  add constraint access_package_assignments_review_kept_pair check ((review_kept_by is null) or (review_kept_at is not null));

create index access_package_assignments_review_due_idx on access_package_assignments (review_due_at)
  where review_due_at is not null and status in ('provisioning', 'active', 'partially_failed');
create index access_package_assignments_review_kept_by_idx on access_package_assignments (review_kept_by) where review_kept_by is not null;
