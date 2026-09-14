import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getFindings } from "@/modules/risk/service";
import { getAgent } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { evaluateAgentRiskAction, assignFindingAction, resolveFindingAction, transitionFindingStatusAction } from "@/app/actions/risk";
import { RemediateFindingButton } from "./RemediateFindingButton";
import { FindingEvidenceTrigger, FindingEvidenceDrawer } from "./FindingEvidenceDrawer";
import { Badge, SeverityBadge, Card, CardHeader, CardBody, Button, AgentTabs, EmptyState } from "@/modules/ui";

const inputClass =
  "block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const labelClass = "block text-sm font-medium text-text-secondary";

/** Agent Detail — Risk & Findings tab (the PRD's "Agent Risk Page" worked
 * layout). Risk Agent owns the finding lifecycle itself; Experience Agent
 * only composes and presents it — see EXPERIENCE-P0-03/04/06. */
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
  const openCount = findings.filter((f) => f.status !== "resolved" && f.status !== "false_positive").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">{agent.agentName}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Risk & Findings — {openCount} open finding{openCount === 1 ? "" : "s"} of {findings.length} total.
        </p>
      </div>

      <AgentTabs agentId={agentId} active="risk" />

      <Suspense fallback={null}>
        <FindingEvidenceDrawer />
      </Suspense>

      <Card>
        <CardHeader
          title="Risk Findings"
          description="Deterministic detection, never an LLM decision (non-negotiable #9)."
          actions={
            <form action={evaluateWithId}>
              <Button type="submit" variant="secondary">
                Run risk evaluation now
              </Button>
            </form>
          }
        />
        <CardBody>
          {findings.length === 0 ? (
            <EmptyState title="No findings recorded for this agent" description="This agent has no open or historical risk findings." />
          ) : (
            <ul className="space-y-3">
              {findings.map((f) => {
                const assignWithIds = assignFindingAction.bind(null, agentId, f.id);
                const resolveWithIds = resolveFindingAction.bind(null, agentId, f.id);
                const transitionWithIds = transitionFindingStatusAction.bind(null, agentId, f.id);
                const isTerminal = f.status === "resolved" || f.status === "false_positive";
                return (
                  <li key={f.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      <Badge tone="neutral">{f.category.replace(/_/g, " ")}</Badge>
                      <Badge tone={isTerminal ? "success" : "warning"}>{f.status.replace(/_/g, " ")}</Badge>
                      <span className="ml-auto text-xs text-text-muted">Score {f.riskScore} · Evaluator v{f.evaluatorVersion}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-text-primary">{f.title}</h3>
                    <p className="mt-1 text-sm text-text-secondary">{f.explanation}</p>
                    <p className="mt-1 text-xs text-text-muted">Why: {f.reasons.join(", ") || "(no contributing factors)"}</p>
                    <p className="mt-2 text-sm">
                      <span className="font-medium text-text-primary">Recommendation: </span>
                      <span className="text-text-secondary">{f.recommendation}</span>
                    </p>
                    {f.status === "false_positive" && (
                      <p className="mt-2 text-xs text-text-muted">
                        Disposed as false positive{f.resolutionReason ? ` — ${f.resolutionReason}` : ""}
                        {f.falsePositiveExpiresAt ? ` (re-checked after ${f.falsePositiveExpiresAt})` : " (no expiry — stays closed until manually reopened)"}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <Suspense fallback={null}>
                        <FindingEvidenceTrigger findingId={f.id} />
                      </Suspense>
                      {(f.status === "open" || f.status === "assigned") && (
                        <RemediateFindingButton findingId={f.id} findingTitle={f.title} />
                      )}
                    </div>

                    {f.status === "open" && (
                      <form action={assignWithIds} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                        <div className="flex-1 min-w-[12rem]">
                          <label className={labelClass}>Assignee</label>
                          <input name="assigneeId" placeholder="assignee user id (uuid)" required className={inputClass} />
                        </div>
                        <Button type="submit" variant="secondary">
                          Assign
                        </Button>
                      </form>
                    )}

                    {!isTerminal && (
                      <form action={transitionWithIds} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                        <div>
                          <label className={labelClass}>Update status</label>
                          <select name="status" defaultValue="acknowledged" className={inputClass}>
                            <option value="acknowledged">acknowledged</option>
                            <option value="investigating">investigating</option>
                            <option value="mitigated">mitigated</option>
                            <option value="exception">exception</option>
                          </select>
                        </div>
                        <Button type="submit" variant="secondary">
                          Update status
                        </Button>
                      </form>
                    )}

                    {!isTerminal && (
                      <form action={resolveWithIds} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                        <div>
                          <label className={labelClass}>Resolution</label>
                          <select name="resolutionType" defaultValue="verified_fixed" className={inputClass}>
                            <option value="verified_fixed">verified_fixed</option>
                            <option value="accepted_risk">accepted_risk</option>
                            <option value="false_positive">false_positive</option>
                          </select>
                        </div>
                        <div className="flex-1 min-w-[10rem]">
                          <label className={labelClass}>Reason</label>
                          <input name="reason" placeholder="required for accepted_risk / false_positive" className={inputClass} />
                        </div>
                        <div>
                          <label className={labelClass}>Re-check after</label>
                          <input name="expiresAt" type="datetime-local" placeholder="false_positive only" className={inputClass} />
                        </div>
                        <Button type="submit" variant="secondary">
                          Resolve
                        </Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
