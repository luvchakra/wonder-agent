-- Runtime Agent — RUNTIME-P0-18 (master stories P0-34 / P0-35): emergency
-- controls the Runtime Gateway honours. Owner: Runtime Agent.
--
-- One row per engaged control. It is active until lifted (lifted_at set);
-- rows are never deleted, so the history of who engaged what, why, and
-- when it was lifted is the evidence (#11).
--
--   kill_switch            every request from every agent in the tenant is denied
--   tool_suspension        requests naming this tool are denied (target = tool name)
--   mcp_server_suspension  requests through this MCP server are denied (target = server name)
--   session_termination    requests in this agent session are denied (target = session id)
--
-- Members can read the controls through RLS; the app gates reads with
-- runtime.read. Writes go only through the service role, behind
-- requirePermission('runtime.emergency'), with a confirmation and a reason.

create table runtime_emergency_controls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  control_type text not null check (control_type in ('kill_switch', 'tool_suspension', 'mcp_server_suspension', 'session_termination')),
  target text check (target is null or char_length(target) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 500),
  engaged_by uuid references users(id),
  engaged_at timestamptz not null default now(),
  lifted_by uuid references users(id),
  lifted_at timestamptz,
  lift_reason text,
  check ((control_type = 'kill_switch') = (target is null))
);

alter table runtime_emergency_controls enable row level security;

create policy runtime_emergency_controls_select on runtime_emergency_controls
  for select
  using (tenant_id in (select current_tenant_ids()));

-- The gateway reads the active controls on every request.
create index runtime_emergency_controls_active_idx on runtime_emergency_controls (tenant_id) where lifted_at is null;
create index runtime_emergency_controls_tenant_time_idx on runtime_emergency_controls (tenant_id, engaged_at desc);
create index runtime_emergency_controls_engaged_by_idx on runtime_emergency_controls (engaged_by);
create index runtime_emergency_controls_lifted_by_idx on runtime_emergency_controls (lifted_by);
-- At most one active kill switch per tenant, and one active control per target.
create unique index runtime_emergency_controls_one_active_idx
  on runtime_emergency_controls (tenant_id, control_type, coalesce(target, ''))
  where lifted_at is null;
