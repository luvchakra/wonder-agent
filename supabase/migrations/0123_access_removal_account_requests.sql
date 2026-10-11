-- Access Agent — ACCESS-P0-30: remove-access and account requests.
-- Owner: Access Agent (access_requests, access_grants,
-- access_fulfilment_tasks). See docs/design/ownership-map.md before
-- modifying.
--
-- A request can now ask to remove access a person holds, or to disable
-- their account on an application; a request for an application with no
-- entitlement (already possible) asks for an account. Each is one line
-- with its own approval route, like a grant request, and each is followed
-- until the source confirms it:
--
-- 1. access_requests.request_type gains 'remove' and 'disable_account'.
--    The existing one-waiting-request key (subject, application,
--    entitlement) is kept: a second waiting request for the same access,
--    whatever its type, is refused until the first is decided.
-- 2. access_grants.removal_status / removal_request_id: an approved
--    removal marks the grant 'pending_removal' (it is still access), done
--    on the target makes it 'removed_unverified', and a full reconciliation
--    that no longer finds it revokes it.
-- 3. access_fulfilment_tasks.kind: 'grant' (0122, on access_grant_id),
--    'remove' (on removal_grant_id), 'create_account' or 'disable_account'
--    (on account_id). One live task per grant or account and kind.
--
-- Additive only: nothing is dropped.

alter table access_requests drop constraint access_requests_request_type_check;
alter table access_requests add constraint access_requests_request_type_check
  check (request_type in ('grant', 'modify', 'remove', 'disable_account'));

alter table access_grants
  add column removal_status text check (removal_status in ('pending_removal', 'removed_unverified')),
  add column removal_request_id uuid,
  add constraint access_grants_removal_request_fkey foreign key (removal_request_id, tenant_id)
    references access_requests (id, tenant_id) on delete set null (removal_request_id);
create index access_grants_removal_request_fk_idx on access_grants (removal_request_id, tenant_id) where removal_request_id is not null;

alter table access_fulfilment_tasks
  alter column access_grant_id drop not null,
  add column removal_grant_id uuid,
  add column account_id uuid,
  add column kind text not null default 'grant' check (kind in ('grant', 'remove', 'create_account', 'disable_account')),
  add constraint access_fulfilment_tasks_removal_grant_fkey foreign key (removal_grant_id, tenant_id) references access_grants (id, tenant_id) on delete cascade,
  add constraint access_fulfilment_tasks_account_fkey foreign key (account_id, tenant_id) references accounts (id, tenant_id) on delete cascade,
  add constraint access_fulfilment_tasks_kind_subject_check check (
    (kind = 'grant' and access_grant_id is not null)
    or (kind = 'remove' and removal_grant_id is not null)
    or (kind in ('create_account', 'disable_account') and account_id is not null)
  );

create unique index access_fulfilment_tasks_removal_key on access_fulfilment_tasks (removal_grant_id)
  where removal_grant_id is not null and status in ('open', 'claimed', 'failed', 'completed');
create unique index access_fulfilment_tasks_account_kind_key on access_fulfilment_tasks (account_id, kind)
  where account_id is not null and status in ('open', 'claimed', 'failed', 'completed');
create index access_fulfilment_tasks_removal_fk_idx on access_fulfilment_tasks (removal_grant_id, tenant_id) where removal_grant_id is not null;
create index access_fulfilment_tasks_account_fk_idx on access_fulfilment_tasks (account_id, tenant_id) where account_id is not null;
