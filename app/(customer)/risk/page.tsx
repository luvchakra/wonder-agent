import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardHeader, CardBody, LinkButton } from "@/modules/ui";
import { RiskAgentsTable } from "./RiskAgentsTable";
import { FindingsList, type FindingRow } from "./FindingsList";

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

  const nameById = new Map(agents.map((a) => [a.id, a.displayName?.trim() || a.agentName]));
  const severityRank: Record<string, number> = rank;
  const findingRows: FindingRow[] = [...findings]
    .sort((a, b) =>
      severityRank[b.severity] - severityRank[a.severity] || b.createdAt.localeCompare(a.createdAt),
    )
    .map((f) => ({
      id: f.id,
      agentId: f.agentId,
      agentName: nameById.get(f.agentId) ?? "Unknown agent",
      title: f.title,
      severity: f.severity,
      category: f.category,
      createdAt: f.createdAt,
    }));
  const renderedAt = new Date().getTime();

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">
          Dashboard
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Risk &amp; Compliance</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Risks &amp; alerts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every open finding, most severe first.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/risk/investigations" variant="outline" size="sm">
            Investigations
          </LinkButton>
          <LinkButton href="/risk/rogue" variant="outline" size="sm">
            Rogue agents
          </LinkButton>
        </div>
      </div>

      <FindingsList findings={findingRows} now={renderedAt} />

      <Card>
        <CardHeader title="By agent" description="Every agent, with its open finding count and worst severity." />
        <CardBody>
          <RiskAgentsTable rows={rows} />
        </CardBody>
      </Card>
    </div>
  );
}
