-- ACCESS-P0-23 part 2 (design §5.3): request delegation. A member lets
-- another member ask for access on their behalf for a time: the delegate
-- may request whatever the delegator could (for themselves, their reports,
-- the identities they own), never with access-manager rights. The request
-- records both: requested_by is who asked, requested_on_behalf_of whom
-- for; neither of them approves it.
--
-- Additive: the scope list gains 'requests' (existing rows are all
-- 'approvals'), and access_requests gains a nullable column.

alter table access_delegations drop constraint access_delegations_scope_check;
alter table access_delegations add constraint access_delegations_scope_check check (scope in ('approvals', 'requests'));

alter table access_requests
  add column requested_on_behalf_of uuid references users(id) on delete set null;

create index access_requests_on_behalf_idx on access_requests (requested_on_behalf_of) where requested_on_behalf_of is not null;
