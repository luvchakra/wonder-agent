import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents, listOwnersForTenant } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, KpiCard, LinkButton } from "@/modules/ui";
import { AgentsTable, type AgentRow } from "./AgentsTable";

// EXPERIENCE-P0-08 — the agent inventory. Rebuilt 2026-09-25 to the
// light-console "Agent Inventory" mockup: a compact metric strip, then one
// card holding the segment tabs, the filters and the table.
//
// Three independent reads, in parallel (CLAUDE.md §15), each from its
// owning module's published contract: the agents (Identity), their
// unresolved findings (Risk) and the tenant's owner assignments (Identity's
// bulk listOwnersForTenant — one query, not one per agent).
const CLOSED_FINDING_STATUSES = new Set(["resolved", "false_positive", "exception", "mitigated"]);

export default async function AgentsPage() {
  let ctx;
  try {
    ctx = await requirePermission("agent.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const tenantId = ctx.tenantId!;
  const [agents, findings, owners] = await Promise.all([
    listAgents(tenantId),
    getFindings(tenantId),
    listOwnersForTenant(tenantId),
  ]);

  const openByAgent = new Map<string, number>();
  const atRisk = new Set<string>();
  for (const f of findings) {
    if (CLOSED_FINDING_STATUSES.has(f.status)) continue;
    openByAgent.set(f.agentId, (openByAgent.get(f.agentId) ?? 0) + 1);
    if (f.severity === "critical" || f.severity === "high") atRisk.add(f.agentId);
  }

  // The owner a row shows is the accountable business owner; the technical
  // owner stands in only when no business owner is assigned.
  const ownerByAgent = new Map<string, { name: string; type: string }>();
  for (const o of owners) {
    if (o.ownerType !== "business_owner" && o.ownerType !== "technical_owner") continue;
    const current = ownerByAgent.get(o.agentId);
    if (current?.type === "business_owner") continue;
    ownerByAgent.set(o.agentId, { name: o.userDisplayName?.trim() || o.userEmail, type: o.ownerType });
  }

  const rows: AgentRow[] = agents.map((a) => ({
    id: a.id,
    agentName: a.agentName,
    displayName: a.displayName,
    agentType: a.agentType,
    sourceSystem: a.sourceSystem,
    framework: a.agentFramework,
    environment: a.environment,
    lifecycleState: a.lifecycleState,
    criticality: a.criticality,
    riskScore: a.riskScore,
    openFindings: openByAgent.get(a.id) ?? 0,
    owner: ownerByAgent.get(a.id)?.name ?? null,
    lastSeenAt: a.lastSeenAt,
    atRisk: atRisk.has(a.id),
  }));

  const nowMs = new Date().getTime();
  const count = (pred: (r: AgentRow) => boolean) => rows.filter(pred).length;

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">
          Home
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Agents</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">AI Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every AI agent registered or discovered in this organization, governed as a first-class enterprise identity.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/agents/discovery" variant="outline" size="sm">
            Discovery inbox
          </LinkButton>
          <LinkButton href="/agents/duplicates" variant="outline" size="sm">
            Duplicate review
          </LinkButton>
          <LinkButton href="/agents/new" size="sm">
            + Register agent
          </LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard size="sm" icon="Bot" tone="primary" label="Total agents" value={rows.length} />
        <KpiCard size="sm" icon="ShieldCheck" tone="success" label="Active" value={count((r) => r.lifecycleState === "ACTIVE" || r.lifecycleState === "CERTIFICATION_DUE")} />
        <KpiCard size="sm" icon="UserSearch" tone="violet" label="Discovered" value={count((r) => r.lifecycleState === "DISCOVERED")} href="/agents/discovery" />
        <KpiCard size="sm" icon="TriangleAlert" tone="danger" label="At risk" value={count((r) => r.atRisk)} href="/risk" />
        <KpiCard size="sm" icon="Users" tone="success" label="Mapped to owners" value={count((r) => r.owner !== null)} />
        <KpiCard size="sm" icon="UserX" tone="warning" label="Unowned" value={count((r) => r.owner === null)} />
      </div>

      <Card className="p-4">
        <AgentsTable agents={rows} nowMs={nowMs} />
      </Card>
    </div>
  );
}
