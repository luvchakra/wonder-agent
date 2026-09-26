-- ACCESS-P0-18 (WonderID Phase 4, 2026-09-26) — self-service request
-- catalog and request policies (spec §11).
--
-- 1. access_request_policies: what may be requested and on what terms —
--    for an application, one of its entitlements, or the tenant default
--    (both null). The most specific active policy applies. It says whether
--    the item is requestable, who may request for whom, the maximum and
--    default duration, whether a justification is required, the risk
--    threshold at or above which approval is always required, whether a
--    request under it may be approved automatically, and the approval
--    route (manager / owner / both), which the approval engine
--    (ACCESS-P0-19) consumes.
-- 2. access_requests grows to requests for identities, not only agents
--    (backward compatible, #13): agent_id becomes nullable; a request names
--    the identity that will receive the access (subject), the requester's
--    identity, the policy applied and its result, the assessed risk, the
--    duration and expiry, and can be cancelled or expire. Every existing
--    row is an agent request and keeps its meaning.
--
-- RLS: policies are read by members and written by the service (service
-- role, tenant-filtered) after access.manage is checked. Identity requests
-- are written by the service too (policy evaluation decides the initial
-- status, which the existing member insert policy — pinned to 'pending' —
-- would not allow for an auto-approved request).

create table access_request_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  application_id uuid,
  entitlement_id uuid,
  requestable boolean not null default true,
  allow_self boolean not null default true,
  -- Who may request for someone else: nobody; the subject's manager (or an
  -- access manager); only access managers.
  allow_for_others text not null default 'managers' check (allow_for_others in ('none', 'managers', 'access_managers')),
  max_duration_days integer check (max_duration_days is null or max_duration_days between 1 and 3650),
  default_duration_days integer check (default_duration_days is null or default_duration_days between 1 and 3650),
  justification_required boolean not null default true,
  risk_threshold text not null default 'high' check (risk_threshold in ('low', 'medium', 'high', 'critical')),
  auto_approve boolean not null default false,
  approval text not null default 'manager_approval' check (approval in ('manager_approval', 'owner_approval', 'manager_and_owner')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  check (entitlement_id is null or application_id is not null),
  check (default_duration_days is null or max_duration_days is null or default_duration_days <= max_duration_days),
  foreign key (application_id, tenant_id) references applications (id, tenant_id) on delete cascade,
  foreign key (entitlement_id, tenant_id) references entitlements (id, tenant_id) on delete cascade
);
-- One policy per scope (tenant default, application, entitlement).
create unique index access_request_policies_scope_key on access_request_policies (
  tenant_id,
  coalesce(application_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(entitlement_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index access_request_policies_app_idx on access_request_policies (application_id, tenant_id);
create index access_request_policies_ent_idx on access_request_policies (entitlement_id, tenant_id);
create index access_request_policies_created_by_idx on access_request_policies (created_by);

alter table access_request_policies enable row level security;
create policy access_request_policies_select on access_request_policies
  for select using (tenant_id in (select current_tenant_ids()));

alter table access_requests alter column agent_id drop not null;
alter table access_requests
  add column subject_identity_id uuid,
  add column requester_identity_id uuid,
  add column request_policy_id uuid,
  add column policy_result jsonb,
  add column risk_level text check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical')),
  add column duration_days integer check (duration_days is null or duration_days between 1 and 3650),
  add column requested_expiry timestamptz,
  add column cancelled_at timestamptz,
  add constraint access_requests_subject_fkey foreign key (subject_identity_id, tenant_id) references identities (id, tenant_id) on delete cascade,
  add constraint access_requests_requester_identity_fkey foreign key (requester_identity_id, tenant_id) references identities (id, tenant_id) on delete set null (requester_identity_id),
  add constraint access_requests_policy_fkey foreign key (request_policy_id, tenant_id) references access_request_policies (id, tenant_id) on delete set null (request_policy_id),
  -- A request is for an agent or for an identity.
  add constraint access_requests_subject_check check (agent_id is not null or subject_identity_id is not null);
alter table access_requests drop constraint access_requests_status_check;
alter table access_requests add constraint access_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled', 'expired'));

create index access_requests_subject_idx on access_requests (subject_identity_id, tenant_id);
create index access_requests_requester_identity_idx on access_requests (requester_identity_id, tenant_id);
create index access_requests_policy_idx on access_requests (request_policy_id, tenant_id);
create index access_requests_tenant_status_idx on access_requests (tenant_id, status, created_at desc);
-- One waiting request per person and item: a second identical request
-- returns the open one (spec §11.5) and two at once cannot both insert.
create unique index access_requests_one_pending_key on access_requests (
  tenant_id, subject_identity_id, application_id, coalesce(entitlement_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status = 'pending' and subject_identity_id is not null;
