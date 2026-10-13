-- Owner decision (2026-10-13): an organization has one plan, the same in
-- every environment. New environments inherit it from now on
-- (inheritOrganizationPlan); this gives each existing environment that has
-- no plan its organization's, with the same limits. Insert only: an
-- environment that already has a plan is left as it is (a plan billed
-- through a payment provider is never overwritten).
insert into subscriptions (tenant_id, plan, max_users, max_agents, max_integrations, max_runtime_events_per_month, audit_retention_days)
select p.tenant_id, s.plan, s.max_users, s.max_agents, s.max_integrations, s.max_runtime_events_per_month, s.audit_retention_days
from platform_tenants p
join tenants t on t.id = p.tenant_id and t.status <> 'deprovisioned'
join lateral (select * from subscriptions o where o.tenant_id = p.parent_tenant_id order by o.started_at desc limit 1) s on true
where p.parent_tenant_id is not null
  and not exists (select 1 from subscriptions e where e.tenant_id = p.tenant_id);
