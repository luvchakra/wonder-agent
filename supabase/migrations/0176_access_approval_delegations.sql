-- ACCESS-P0-23 (design §5.3): approver delegation. A member hands their
-- approvals to another member for a time (out of office or standing). The
-- delegate decides the steps that name the delegator, on their behalf; the
-- step records both (decided_by is who decided, decided_on_behalf_of whom
-- they decided for). Time-limited, never to oneself; the approval engine
-- still refuses anyone deciding a request they made or that is for them.
--
-- Members see the delegations they give or receive; an access manager sees
-- all of the organization's. The Access service writes.

create table access_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  delegator_user_id uuid not null,
  delegate_user_id uuid not null,
  scope text not null default 'approvals' check (scope in ('approvals')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (reason is null or char_length(reason) <= 500),
  created_by uuid references users(id) on delete set null,
  revoked_by uuid references users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, delegator_user_id) references tenant_memberships (tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, delegate_user_id) references tenant_memberships (tenant_id, user_id) on delete cascade,
  check (delegator_user_id <> delegate_user_id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '180 days')
);

create index access_delegations_delegate_idx on access_delegations (tenant_id, delegate_user_id, ends_at) where revoked_at is null;
create index access_delegations_delegator_idx on access_delegations (tenant_id, delegator_user_id, ends_at) where revoked_at is null;
create index access_delegations_created_by_idx on access_delegations (created_by) where created_by is not null;
create index access_delegations_revoked_by_idx on access_delegations (revoked_by) where revoked_by is not null;

alter table access_delegations enable row level security;
create policy access_delegations_select on access_delegations for select
  using (
    tenant_id in (select current_tenant_ids())
    and ((select auth.uid()) in (delegator_user_id, delegate_user_id) or has_tenant_permission(tenant_id, 'access.manage'))
  );

alter table access_request_approvals
  add column decided_on_behalf_of uuid references users(id) on delete set null;

create index access_request_approvals_on_behalf_idx on access_request_approvals (decided_on_behalf_of) where decided_on_behalf_of is not null;
