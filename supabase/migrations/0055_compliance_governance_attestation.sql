-- Compliance Agent — COMPLIANCE-P0-08 (Governance Attestation, broad)
-- Owner: Compliance Agent. See docs/design/ownership-map.md before modifying.
--
-- Distinct from Identity's own narrower (unbuilt, still-P1) self-attestation
-- concept referenced in docs/plan/02-IDENTITY-AGENT-BACKLOG.md's P1 list —
-- this is the broader, Compliance-owned approver/decision/evidence shape the
-- user chose on 2026-09-15. governance_attestations has no client-facing
-- write policy — same evidentiary lockdown as certification_decisions
-- (migration 0036): a decision is written once, server-mediated, audited,
-- and never edited (non-negotiable #11); a correction is a new row.

create table governance_attestations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  policy_requirement text not null,
  checklist jsonb not null default '[]'::jsonb,
  approver_id uuid not null references users(id),
  decision text not null check (decision in ('attested','rejected','needs_more_info')),
  comments text,
  evidence_references jsonb not null default '[]'::jsonb,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index governance_attestations_tenant_agent_idx on governance_attestations (tenant_id, agent_id);
create index governance_attestations_approver_id_idx on governance_attestations (approver_id);

alter table governance_attestations enable row level security;

create policy governance_attestations_select on governance_attestations
  for select using (tenant_id in (select current_tenant_ids()));
