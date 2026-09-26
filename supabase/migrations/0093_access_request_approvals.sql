-- ACCESS-P0-19 (WonderID Phase 4, 2026-09-26) — the approval engine for
-- identity access requests (spec §11.1 "see approval chain", §19.6
-- approval scope, §37A.27 / invariant S4 approval integrity).
--
-- 1. access_request_approvals: one row per approval step of a request.
--    Steps are resolved from the request policy's route when the request is
--    submitted: the subject's manager, the entitlement owner (else the
--    application's business owner), and — for critical risk — an access
--    manager review. Steps in the same stage run in parallel; stages run in
--    order. A step names the one person who may decide it, or is open to
--    access managers (when nobody suitable is recorded, when the resolved
--    person is the requester or the subject, or after escalation). Each
--    step carries the action fingerprint it was opened under: a change to
--    the requested resource, privilege, duration or policy invalidates
--    every step and the chain starts again.
-- 2. access_request_policies gains the approval mode (sequential or
--    parallel for a two-party route), the time each approver has, and what
--    happens when it runs out (escalate to access managers, or expire).
-- 3. entitlements gains an owner (an identity), who approves requests for
--    that entitlement ahead of the application's business owner.
-- 4. access_requests gains the fingerprint and current stage.
--
-- RLS: steps are read by members and written only by the service (service
-- role, tenant-filtered). A trigger enforces four-eyes in the database: a
-- step can never be decided by the request's requester or by the person
-- the access is for, whatever path writes it.

alter table entitlements
  add column owner_identity_id uuid,
  add constraint entitlements_owner_fkey foreign key (owner_identity_id, tenant_id)
    references identities (id, tenant_id) on delete set null (owner_identity_id);
create index entitlements_owner_idx on entitlements (owner_identity_id, tenant_id) where owner_identity_id is not null;

alter table access_request_policies
  add column approval_mode text not null default 'sequential' check (approval_mode in ('sequential', 'parallel')),
  add column approval_timeout_days integer not null default 5 check (approval_timeout_days between 1 and 60),
  add column on_timeout text not null default 'escalate' check (on_timeout in ('escalate', 'expire'));

alter table access_requests
  add column action_fingerprint text,
  add column approval_stage integer check (approval_stage is null or approval_stage >= 1),
  add constraint access_requests_id_tenant_key unique (id, tenant_id);

create table access_request_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  request_id uuid not null,
  stage integer not null check (stage between 1 and 10),
  -- Who the step asks: the subject's manager, the entitlement owner, the
  -- application owner, or any access manager.
  approver_kind text not null check (approver_kind in ('manager', 'entitlement_owner', 'application_owner', 'access_managers')),
  -- Why this step asks whom (e.g. "No manager is recorded").
  reason text,
  approver_identity_id uuid,
  approver_user_id uuid references users(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'pending', 'approved', 'rejected', 'skipped', 'expired', 'invalidated')),
  action_fingerprint text not null check (char_length(action_fingerprint) = 64),
  policy_version timestamptz,
  due_at timestamptz,
  escalated_at timestamptz,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  decider_roles text[],
  comment text check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  -- A named approver is a person; an access-manager step names nobody.
  check ((approver_kind = 'access_managers') = (approver_user_id is null)),
  -- A decision records when (and who, while that user exists); an open step
  -- has none. An invalidated step keeps the decision it had, for the record.
  constraint access_request_approvals_decided_check check (status not in ('approved', 'rejected') or decided_at is not null),
  constraint access_request_approvals_open_undecided_check check (status not in ('waiting', 'pending') or (decided_by is null and decided_at is null)),
  foreign key (request_id, tenant_id) references access_requests (id, tenant_id) on delete cascade,
  foreign key (approver_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (approver_identity_id)
);
-- One open step per request, stage and approver: two services building the
-- same chain at once cannot both insert it.
create unique index access_request_approvals_open_key on access_request_approvals (
  request_id, stage, approver_kind, coalesce(approver_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status in ('waiting', 'pending');
create index access_request_approvals_request_idx on access_request_approvals (request_id, tenant_id, stage);
create index access_request_approvals_approver_idx on access_request_approvals (tenant_id, approver_user_id, status);
create index access_request_approvals_open_idx on access_request_approvals (tenant_id, status, due_at) where status = 'pending';
create index access_request_approvals_identity_idx on access_request_approvals (approver_identity_id, tenant_id);
create index access_request_approvals_decided_by_idx on access_request_approvals (decided_by);
create index access_request_approvals_user_idx on access_request_approvals (approver_user_id);

alter table access_request_approvals enable row level security;
create policy access_request_approvals_select on access_request_approvals
  for select using (tenant_id in (select current_tenant_ids()));

-- Four-eyes, in the database: nobody decides a step of a request they made
-- or that is for them.
create function access_request_approvals_four_eyes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if new.decided_by is null then
    return new;
  end if;
  select ar.requested_by, i.user_id as subject_user_id
    into r
    from access_requests ar
    left join identities i on i.id = ar.subject_identity_id and i.tenant_id = ar.tenant_id
   where ar.id = new.request_id and ar.tenant_id = new.tenant_id;
  if new.decided_by = r.requested_by or new.decided_by = r.subject_user_id then
    raise exception 'an approval step cannot be decided by the requester or the person the access is for'
      using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function access_request_approvals_four_eyes() from public, anon, authenticated;

create trigger access_request_approvals_four_eyes
  before insert or update of decided_by on access_request_approvals
  for each row execute function access_request_approvals_four_eyes();
