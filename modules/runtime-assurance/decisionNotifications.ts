import "server-only";

import type { NotifyEvent } from "@/lib/shared/types/operations";
import type { GatewayDecision } from "@/lib/shared/types/runtime";
import type { RuntimeRequest } from "@/lib/shared/types/access-governance";
import { notify, wasRecentlyNotified } from "@/modules/operations/service";
import { getAgentDisplayName } from "@/modules/agent-identity/service";

/**
 * OPERATIONS-P0-08 (master stories P0-41) — runtime and approval
 * notifications, raised by the Runtime Gateway through Operations'
 * published `notify()`.
 *
 * - Only decisions that actually stopped an agent notify: DENY or
 *   REQUIRE_APPROVAL **as enforced**. In OBSERVE_ONLY mode the agent was
 *   told to proceed, so nothing was blocked and nothing is waiting on a
 *   person; those decisions stay on the Runtime page only (§17.5: never
 *   imply an action happened that did not).
 * - A replayed request id never notifies again (the caller only reaches
 *   here for a newly recorded decision).
 * - One notification per agent and type per THROTTLE_MINUTES. An agent
 *   retrying a denied call would otherwise raise one per attempt. Every
 *   decision is still recorded and listed on the Runtime page.
 * - Never throws: a notification failure must never affect the decision
 *   already returned to the agent.
 */

export const THROTTLE_MINUTES = 15;

type DecisionFacts = Pick<GatewayDecision, "decisionId" | "requestId" | "effectiveDecision" | "enforced" | "code" | "reason">;

/** Pure: the notification a decision raises, or null when it raises none. */
export function notificationForDecision(
  tenantId: string,
  agentId: string,
  agentName: string,
  decision: DecisionFacts,
  request: Pick<RuntimeRequest, "action" | "application" | "resource" | "tool">,
): NotifyEvent | null {
  if (!decision.enforced) return null;
  const target = [request.tool && `tool ${request.tool}`, request.application && `application ${request.application}`, request.resource && `resource ${request.resource}`]
    .filter(Boolean)
    .join(", ");
  const what = `${request.action}${target ? ` on ${target}` : ""}`;
  const detail = `${decision.reason.replace(/\.$/, "")} (${decision.code}; request ${decision.requestId}). Further decisions for this agent in the next ${THROTTLE_MINUTES} minutes are listed on the Runtime page without a new notification.`;

  if (decision.effectiveDecision === "DENY") {
    return {
      tenantId,
      type: "runtime_alert",
      title: `Runtime Gateway blocked ${agentName}: ${what}`,
      body: detail,
      referenceType: "agent",
      referenceId: agentId,
    };
  }
  if (decision.effectiveDecision === "REQUIRE_APPROVAL") {
    return {
      tenantId,
      type: "approval_required",
      title: `${agentName} is waiting for approval: ${what}`,
      body: detail,
      referenceType: "agent",
      referenceId: agentId,
    };
  }
  return null;
}

export async function notifyForDecision(
  tenantId: string,
  agentId: string,
  decision: DecisionFacts,
  request: Pick<RuntimeRequest, "action" | "application" | "resource" | "tool">,
): Promise<void> {
  try {
    // Cheap exit first: most decisions raise nothing.
    const draft = notificationForDecision(tenantId, agentId, "", decision, request);
    if (!draft) return;
    if (await wasRecentlyNotified(tenantId, draft.type, agentId, THROTTLE_MINUTES / (24 * 60))) return;
    const agentName = (await getAgentDisplayName(tenantId, agentId)) ?? "An agent";
    const event = notificationForDecision(tenantId, agentId, agentName, decision, request);
    if (event) await notify(event);
  } catch (err) {
    console.error("notifyForDecision failed", { decisionId: decision.decisionId, err });
  }
}
