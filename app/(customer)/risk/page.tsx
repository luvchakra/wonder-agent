import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody } from "@/modules/ui";
import { RiskAgentsTable } from "./RiskAgentsTable";

// Composition-only index over Identity's agents + Risk's findings, per
// EXPERIENCE-P0-03 — Risk Agent owns /risk/agents/:id itself; this list
// view is Experience Agent's own addition to make that reachable from nav
// (no bare index page existed before this story).
export default async function RiskIndexPage() {
  let ctx;
  try {
    ctx = await requirePermission("risk.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const [agents, findings] = await Promise.all([listAgents(ctx.tenantId!), getFindings(ctx.tenantId!, { status: "open" })]);
  const findingCountByAgent = new Map<string, number>();
  const worstSeverityByAgent = new Map<string, string>();
  const rank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  for (const f of findings) {
    findingCountByAgent.set(f.agentId, (findingCountByAgent.get(f.agentId) ?? 0) + 1);
    const current = worstSeverityByAgent.get(f.agentId);
    if (!current || rank[f.severity] > rank[current]) worstSeverityByAgent.set(f.agentId, f.severity);
  }

  const rows = agents.map((a) => ({
    id: a.id,
    agentName: a.agentName,
    openFindings: findingCountByAgent.get(a.id) ?? 0,
    worstSeverity: worstSeverityByAgent.get(a.id) ?? null,
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Risk</h1>
      <Card>
        <CardBody>
          <RiskAgentsTable rows={rows} />
        </CardBody>
      </Card>
    </div>
  );
}
