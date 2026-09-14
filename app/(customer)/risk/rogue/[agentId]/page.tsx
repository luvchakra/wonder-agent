import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getAgent, getOwnershipIssues, listOwners } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { compareShouldCanDid } from "@/modules/runtime-assurance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RogueCategory } from "@/lib/shared/types/risk";
import { Badge, SeverityBadge, Card, CardHeader, CardBody, EmptyState } from "@/modules/ui";

const ROGUE_CATEGORIES: RogueCategory[] = ["behavioral_deviation", "identity_anomaly", "ownership_violation", "lifecycle_violation"];

/**
 * PRD §37 — Rogue Agent Detail. A dedicated investigation surface distinct
 * from the general per-agent Risk tab (/risk/agents/:id): it leads with
 * WHY this agent is flagged (the specific rogue-category findings and the
 * SHOULD/CAN/DID deviation behind them) and the accountability chain
 * (ownership), rather than a flat list of every finding of every category.
 * Composes Identity/Risk/Runtime's published contracts only — no new
 * business logic, same as every other Experience Agent screen.
 */
export default async function RogueAgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  let ctx;
  try {
    ctx = await requirePermission("risk.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const agent = await getAgent(ctx.tenantId!, agentId);
  if (!agent) redirect("/risk/rogue");

  const [findings, owners, ownershipIssues, comparison] = await Promise.all([
    getFindings(ctx.tenantId!, { agentId }),
    listOwners(ctx.tenantId!, agentId),
    getOwnershipIssues(ctx.tenantId!, agentId, agent.criticality),
    compareShouldCanDid(ctx.tenantId!, agentId),
  ]);

  const rogueFindings = findings.filter((f) => ROGUE_CATEGORIES.includes(f.category) && f.status !== "resolved" && f.status !== "false_positive");
  const deviations = comparison.outcomes.filter((o) => o.type !== "healthy");

  return (
    <div className="space-y-4">
      <Link href="/risk/rogue" className="text-sm text-primary hover:underline">
        ← Rogue Agents
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{agent.agentName}</h1>
          <Badge tone="danger">Rogue behavior flagged</Badge>
          <SeverityBadge severity={agent.criticality} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {agent.agentType} · {agent.environment} · lifecycle: {agent.lifecycleState}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <Link href={`/agents/${agentId}`} className="text-primary hover:underline">
            Agent Overview
          </Link>
          {" · "}
          <Link href={`/access/agents/${agentId}`} className="text-primary hover:underline">
            Access (CAN)
          </Link>
          {" · "}
          <Link href={`/runtime/agents/${agentId}`} className="text-primary hover:underline">
            Runtime (DID)
          </Link>
          {" · "}
          <Link href={`/risk/agents/${agentId}`} className="text-primary hover:underline">
            All findings
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader title="Why this agent is flagged" description="Behavioral deviation, identity anomaly, ownership, or lifecycle findings — not access-scope findings (see All findings for those)." />
        <CardBody>
          {rogueFindings.length === 0 ? (
            <EmptyState title="No open rogue-behavior findings" description="This agent was flagged previously but has no currently open rogue-category finding." />
          ) : (
            <ul className="space-y-3">
              {rogueFindings.map((f) => (
                <li key={f.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <Badge tone="neutral">{f.category.replace(/_/g, " ")}</Badge>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="SHOULD vs CAN vs DID deviation"
          description="The runtime comparison behind the behavioral-deviation findings above (CLAUDE.md §9)."
        />
        <CardBody>
          {comparison.shouldUnknown && <Badge tone="warning">SHOULD undefined — no active contract to compare against</Badge>}
          {!comparison.shouldUnknown && deviations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deviation outcomes — this agent&apos;s runtime activity matches its approved contract.</p>
          ) : (
            <ul className="space-y-2">
              {deviations.map((o, i) => (
                <li key={i} className="rounded-md border border-border bg-muted p-2 text-sm">
                  <Badge tone="danger">{o.type.replace(/_/g, " ")}</Badge>
                  <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(o.evidence, null, 2)}</pre>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Accountability" description="Ownership chain — who is responsible for reviewing this agent." />
        <CardBody className="space-y-2">
          {owners.length === 0 ? (
            <EmptyState title="No owner assigned" description="An unowned flagged agent is a governance gap — assign an owner from the Agent Overview tab." />
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {owners.map((o) => (
                <li key={o.id}>
                  <Badge tone="neutral">{o.ownerType}</Badge> <span className="ml-1">{o.userId}</span>
                </li>
              ))}
            </ul>
          )}
          {ownershipIssues.length > 0 && (
            <ul className="space-y-1">
              {ownershipIssues.map((issue, i) => (
                <li key={i}>
                  <Badge tone="warning">{JSON.stringify(issue)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
