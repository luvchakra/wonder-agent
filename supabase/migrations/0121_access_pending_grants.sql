-- Access Agent — ACCESS-P0-28: approved requests become pending grants,
-- verified by reconciliation.
-- Owner: Access Agent (access_grants, accounts). See
-- docs/design/ownership-map.md before modifying.
--
-- Until now an approval wrote nothing but the request's status, and "mark
-- fulfilled" was a claim nobody checked. Now:
--
-- 1. access_grants.fulfilment_status: 'none' for access a connection,
--    file or administrator recorded (every existing row); for access a
--    request or package asked for, 'pending_fulfilment' on approval,
--    'fulfilled_unverified' once a person says it was done on the target,
--    and 'verified' when reconciliation finds it there (verified_at).
--    A pending row is not access yet: every reader of effective access
--    skips 'pending_fulfilment'.
-- 2. access_grants.request_id / access_package_assignment_item_id: what
--    asked for the grant (same-tenant keys). One grant per request and
--    entitlement, and one per package item, so an approval run twice adds
--    nothing.
-- 3. accounts.status 'pending' and source 'request': when the subject has
--    no account on the application yet, the request creates a placeholder
--    to hold its pending grant. Account reconciliation replaces it with
--    the real account when that appears, and never marks it missing.
--
-- No client write policy is added: grants and accounts stay written by
-- the Access module's services only (0027, 0089).

alter table access_grants
  add column fulfilment_status text not null default 'none'
    check (fulfilment_status in ('none', 'pending_fulfilment', 'fulfilled_unverified', 'verified')),
  add column request_id uuid,
  add column access_package_assignment_item_id uuid,
  add column verified_at timestamptz,
  add constraint access_grants_request_fkey foreign key (request_id, tenant_id)
    references access_requests (id, tenant_id) on delete set null (request_id),
  add constraint access_grants_package_item_fkey foreign key (access_package_assignment_item_id, tenant_id)
    references access_package_assignment_items (id, tenant_id) on delete set null (access_package_assignment_item_id),
  add constraint access_grants_verified_check check ((fulfilment_status = 'verified') = (verified_at is not null));

create unique index access_grants_request_entitlement_key on access_grants (request_id, entitlement_id)
  where request_id is not null and access_package_assignment_item_id is null;
create unique index access_grants_package_item_key on access_grants (access_package_assignment_item_id)
  where access_package_assignment_item_id is not null;
create index access_grants_request_fk_idx on access_grants (request_id, tenant_id) where request_id is not null;
create index access_grants_package_item_fk_idx on access_grants (access_package_assignment_item_id, tenant_id)
  where access_package_assignment_item_id is not null;
create index access_grants_unfulfilled_idx on access_grants (tenant_id, account_id)
  where fulfilment_status in ('pending_fulfilment', 'fulfilled_unverified');

alter table accounts drop constraint accounts_status_check;
alter table accounts add constraint accounts_status_check check (status in ('active', 'disabled', 'pending'));
alter table accounts drop constraint accounts_source_check;
alter table accounts add constraint accounts_source_check check (source in ('manual', 'reconciliation', 'request'));
create index accounts_pending_idx on accounts (tenant_id, application_id) where status = 'pending';
