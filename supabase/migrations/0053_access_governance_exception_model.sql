-- Access Agent — ACCESS-P0-07
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.
--
-- Governance requirements reconciliation (2026-09-15): user decision
-- "broaden Access's policy_exceptions" — this table becomes the canonical
-- exception model for any governance requirement, not just access policy.
-- Compliance Agent's planned CERT-P1-04 (control-mapping exceptions) will
-- reference this table rather than introduce its own.
--
-- policy_exceptions previously had no tenant_id of its own (isolation was
-- via a join through policies.tenant_id) — that only worked because every
-- exception was required to reference a policy. Now that an exception can
-- target something other than a policy (scope_type <> 'policy'), tenant_id
-- must be a real column so isolation doesn't depend on a join that may not
-- exist for non-policy exceptions.

alter table policy_exceptions add column tenant_id uuid references tenants(id) on delete cascade;

update policy_exceptions pe
  set tenant_id = p.tenant_id
  from policies p
  where pe.policy_id = p.id;

alter table policy_exceptions alter column tenant_id set not null;
alter table policy_exceptions alter column policy_id drop not null;

alter table policy_exceptions
  add column scope_type text not null default 'policy'
    check (scope_type in ('policy', 'attestation', 'certification', 'control_mapping', 'contract_requirement')),
  add column scope_id uuid,
  add column business_justification text,
  add column compensating_control text,
  add column residual_risk text check (residual_risk in ('low', 'medium', 'high', 'critical')),
  add column status text not null default 'active' check (status in ('active', 'revoked')),
  add column start_date timestamptz not null default now(),
  add constraint policy_exceptions_policy_scope_requires_policy_id
    check (scope_type <> 'policy' or policy_id is not null);

create index policy_exceptions_tenant_id_idx on policy_exceptions (tenant_id);
create index policy_exceptions_scope_idx on policy_exceptions (scope_type, scope_id);

-- Existing rows all have approved_by set (it was already NOT NULL), so
-- they're all already-approved exceptions — 'active' is the correct
-- backfilled status for them, not a change of meaning.

-- Replace the join-based RLS policies with tenant_id-based ones now that
-- the column exists directly — simpler and correct for non-policy
-- exceptions too. Still no client UPDATE/DELETE policy: revocation goes
-- through the service-role client (revokeException(), manual tenant
-- check), matching every other state-changing write in this codebase that
-- has no client-facing update policy.
drop policy policy_exceptions_select on policy_exceptions;
drop policy policy_exceptions_insert on policy_exceptions;

create policy policy_exceptions_select on policy_exceptions
  for select using (tenant_id in (select current_tenant_ids()));
create policy policy_exceptions_insert on policy_exceptions
  for insert with check (tenant_id in (select current_tenant_ids()));
