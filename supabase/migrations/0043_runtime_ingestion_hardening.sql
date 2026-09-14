-- Runtime Agent — RUNTIME-P0-11
-- Owner: Runtime Agent. See docs/design/ownership-map.md before modifying.
--
-- Evidentiary data (like risk_findings) — client SELECT only, all writes
-- via supabaseServiceRole() from modules/runtime-assurance/quarantine.ts.
-- Stores only safe, non-secret-leaking fields — never the full raw event
-- payload, which could contain sensitive request data from a misbehaving
-- or malicious source.

create table runtime_event_quarantine (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  reason text not null,
  source text,
  action text,
  submitted_event_time text,
  attempted_dedupe_key text,
  received_at timestamptz not null default now()
);

create index runtime_event_quarantine_tenant_id_idx on runtime_event_quarantine (tenant_id, received_at desc);

alter table runtime_event_quarantine enable row level security;

create policy runtime_event_quarantine_select on runtime_event_quarantine
  for select using (tenant_id in (select current_tenant_ids()));
