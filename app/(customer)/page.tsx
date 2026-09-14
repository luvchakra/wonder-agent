import Link from "next/link";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { listAgents, getOwnershipIssues } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { listCampaigns, listCampaignItems } from "@/modules/certification-compliance/service";
import { StatCard, Card, CardHeader, CardBody, SeverityBadge, EmptyState } from "@/modules/ui";
import { RiskTrendChart } from "@/modules/ui/RiskTrendChart";

// EXPERIENCE-P0-02.1/02.2. Every card is a real query against the owning
// module's published contract — never a hardcoded number. Fetched in
// parallel (CLAUDE.md §15 — no sequential waterfalls).
export default async function OverviewPage() {
  const ctx = await getTenantContext();
  const tenantId = ctx.tenantId!;

  const [agents, openFindings, campaigns] = await Promise.all([
    listAgents(tenantId),
    getFindings(tenantId, { status: "open" }),
    listCampaigns(tenantId),
  ]);

  // Identity doesn't publish a bulk "agents with ownership issues" query —
  // fanned out in parallel per agent rather than sequentially, which is
  // acceptable at P0 fixture scale; a bulk contract from Identity would be
  // needed before this scales to thousands of agents.
  const ownershipResults = await Promise.all(agents.map((a) => getOwnershipIssues(tenantId, a.id, a.criticality)));
  const unownedCount = ownershipResults.filter((issues) => issues.length > 0).length;

  const activeCampaignItems = (
    await Promise.all(campaigns.filter((c) => c.status === "active").map((c) => listCampaignItems(tenantId, c.id)))
  ).flat();
  const now = new Date().toISOString();
  const overdueCertifications = activeCampaignItems.filter((i) => i.status === "pending" && i.dueDate && i.dueDate < now);

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const f of openFindings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  const excessiveAccessAgents = new Set(openFindings.filter((f) => f.category === "excessive_access").map((f) => f.agentId)).size;
  const restrictedAgents = agents.filter((a) => a.lifecycleState === "RESTRICTED");

  const actionQueue = [
    ...campaigns
      .filter((c) => c.status === "active")
      .flatMap((c) => [{ label: `Review "${c.name}" certification items`, href: `/compliance/campaigns/${c.id}` }]),
    ...openFindings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .slice(0, 8)
      .map((f) => ({ label: f.title, href: `/risk/agents/${f.agentId}` })),
  ].slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Overview</h1>
        <p className="text-sm text-muted-foreground">Tenant {ctx.tenantSlug}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total AI Agents" value={agents.length} />
        <StatCard label="Active" value={agents.filter((a) => a.lifecycleState === "ACTIVE").length} />
        <StatCard label="Unowned" value={unownedCount} tone={unownedCount > 0 ? "warning" : "neutral"} />
        <StatCard label="Certification Overdue" value={overdueCertifications.length} tone={overdueCertifications.length > 0 ? "warning" : "neutral"} />
        <StatCard label="High Risk" value={bySeverity.high} tone={bySeverity.high > 0 ? "warning" : "neutral"} />
        <StatCard label="Critical Risk" value={bySeverity.critical} tone={bySeverity.critical > 0 ? "danger" : "neutral"} />
        <StatCard label="Policy/Access Violations" value={openFindings.length} tone={openFindings.length > 0 ? "warning" : "neutral"} />
        <StatCard label="Rogue / Restricted Agents" value={restrictedAgents.length} tone={restrictedAgents.length > 0 ? "danger" : "neutral"} />
        <StatCard label="Excessive Access" value={excessiveAccessAgents} tone={excessiveAccessAgents > 0 ? "warning" : "neutral"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Risk by severity" description="Open findings, tenant-wide" />
          <CardBody>
            <RiskTrendChart bySeverity={bySeverity} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Action queue" description="Open items needing attention" />
          <CardBody>
            {actionQueue.length === 0 ? (
              <EmptyState title="Nothing needs attention right now" />
            ) : (
              <ul className="space-y-2">
                {actionQueue.map((item, i) => (
                  <li key={i}>
                    <Link href={item.href} className="text-sm text-primary hover:underline">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {openFindings.length > 0 && (
        <Card>
          <CardHeader title="Recent findings" />
          <CardBody className="space-y-2">
            {openFindings.slice(0, 5).map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/risk/agents/${f.agentId}`} className="text-foreground hover:text-primary">
                  {f.title}
                </Link>
                <SeverityBadge severity={f.severity} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
