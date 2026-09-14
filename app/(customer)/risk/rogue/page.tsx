import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { getFindings } from "@/modules/risk/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RogueCategory } from "@/lib/shared/types/risk";
import { Card, CardBody, SeverityBadge, TableContainer, Thead, Th, Tr, Td, EmptyState } from "@/modules/ui";
import Link from "next/link";

/**
 * Rogue-agent-behavior categories, as distinct from the access-violation
 * subset — the same partition Operations Agent's generateRogueAgentReport()
 * uses (modules/operations/reports.ts), kept in sync here rather than
 * inventing a different definition for the UI. An explicit, documented
 * partition of Risk's eight categories, not a Risk Agent contract change.
 */
const ROGUE_CATEGORIES: RogueCategory[] = ["behavioral_deviation", "identity_anomaly", "ownership_violation", "lifecycle_violation"];

// The PRD's Rogue Agent Detail worked layout (§37) starts from this index —
// agents currently showing rogue-category findings, distinct from the
// general Risk index (/risk) which lists every agent's findings of any
// category.
export default async function RogueAgentsPage() {
  let ctx;
  try {
    ctx = await requirePermission("risk.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const [agents, findings] = await Promise.all([listAgents(ctx.tenantId!), getFindings(ctx.tenantId!, { status: "open" })]);
  const rogueFindings = findings.filter((f) => ROGUE_CATEGORIES.includes(f.category));

  const worstByAgent = new Map<string, string>();
  const countByAgent = new Map<string, number>();
  const rank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  for (const f of rogueFindings) {
    countByAgent.set(f.agentId, (countByAgent.get(f.agentId) ?? 0) + 1);
    const current = worstByAgent.get(f.agentId);
    if (!current || rank[f.severity] > rank[current]) worstByAgent.set(f.agentId, f.severity);
  }

  const flaggedAgents = agents.filter((a) => countByAgent.has(a.id));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Rogue Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Agents with open behavioral deviation, identity anomaly, ownership, or lifecycle findings — deterministic detection
          from Risk Agent, never an LLM judgment (non-negotiable #9).
        </p>
      </div>

      <Card>
        <CardBody>
          {flaggedAgents.length === 0 ? (
            <EmptyState title="No agents currently flagged" description="No open rogue-behavior findings across this tenant." />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>Open findings</Th>
                  <Th>Worst severity</Th>
                </tr>
              </Thead>
              <tbody>
                {flaggedAgents.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <Link href={`/risk/rogue/${a.id}`} className="text-primary hover:underline">
                        {a.agentName}
                      </Link>
                    </Td>
                    <Td>{countByAgent.get(a.id)}</Td>
                    <Td>
                      <SeverityBadge severity={worstByAgent.get(a.id)!} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
