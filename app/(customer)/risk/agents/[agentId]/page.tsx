import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getFindings } from "@/modules/risk/service";
import { getAgent } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { evaluateAgentRiskAction, assignFindingAction, resolveFindingAction, transitionFindingStatusAction } from "@/app/actions/risk";
import { RemediateFindingButton } from "./RemediateFindingButton";
import { FindingEvidenceTrigger, FindingEvidenceDrawer } from "./FindingEvidenceDrawer";

// Bare functional screen — Experience Agent (Module 08) owns visual design,
// per docs/design/UI-UX-DESIGN-RULES.md. This page is functional scaffolding.
export default async function AgentRiskPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  let ctx;
  try {
    ctx = await requirePermission("risk.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const agent = await getAgent(ctx.tenantId!, agentId);
  if (!agent) redirect("/agents");

  const findings = await getFindings(ctx.tenantId!, { agentId });
  const evaluateWithId = evaluateAgentRiskAction.bind(null, agentId);

  return (
    <main style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href={`/agents/${agentId}`}>← {agent.agentName}</Link>
      </p>
      <h1>Risk Findings</h1>

      <form action={evaluateWithId}>
        <button type="submit">Run risk evaluation now</button>
      </form>

      {findings.length === 0 && <p>No findings recorded for this agent.</p>}

      <Suspense fallback={null}>
        <FindingEvidenceDrawer />
      </Suspense>

      {findings.map((f) => {
        const assignWithIds = assignFindingAction.bind(null, agentId, f.id);
        const resolveWithIds = resolveFindingAction.bind(null, agentId, f.id);
        const transitionWithIds = transitionFindingStatusAction.bind(null, agentId, f.id);
        const isTerminal = f.status === "resolved" || f.status === "false_positive";
        return (
          <section key={f.id} style={{ border: "1px solid #ccc", margin: "1rem 0", padding: "1rem" }}>
            <h2>
              [{f.severity.toUpperCase()}] {f.title}
            </h2>
            <p>
              Category: {f.category} · Status: {f.status} · Score: {f.riskScore} · Evaluator v{f.evaluatorVersion}
            </p>
            <p>Why: {f.reasons.join(", ") || "(no contributing factors)"}</p>
            <p>{f.explanation}</p>
            <p>
              <strong>Recommendation:</strong> {f.recommendation}
            </p>
            {f.status === "false_positive" && (
              <p>
                Disposed as false positive{f.resolutionReason ? ` — ${f.resolutionReason}` : ""}
                {f.falsePositiveExpiresAt ? ` (re-checked after ${f.falsePositiveExpiresAt})` : " (no expiry — stays closed until manually reopened)"}
              </p>
            )}

            {f.status === "open" && (
              <form action={assignWithIds}>
                <input name="assigneeId" placeholder="assignee user id (uuid)" required />
                <button type="submit">Assign</button>
              </form>
            )}

            {(f.status === "open" || f.status === "assigned") && <RemediateFindingButton findingId={f.id} findingTitle={f.title} />}

            <Suspense fallback={null}>
              <FindingEvidenceTrigger findingId={f.id} />
            </Suspense>

            {!isTerminal && (
              <form action={transitionWithIds}>
                <select name="status" defaultValue="acknowledged">
                  <option value="acknowledged">acknowledged</option>
                  <option value="investigating">investigating</option>
                  <option value="mitigated">mitigated</option>
                  <option value="exception">exception</option>
                </select>
                <button type="submit">Update status</button>
              </form>
            )}

            {!isTerminal && (
              <form action={resolveWithIds}>
                <select name="resolutionType" defaultValue="verified_fixed">
                  <option value="verified_fixed">verified_fixed</option>
                  <option value="accepted_risk">accepted_risk</option>
                  <option value="false_positive">false_positive</option>
                </select>
                <input name="reason" placeholder="reason (required for accepted_risk / false_positive)" />
                <input name="expiresAt" type="datetime-local" placeholder="re-check after (false_positive only)" />
                <button type="submit">Resolve</button>
              </form>
            )}
          </section>
        );
      })}
    </main>
  );
}
