import type { DetectionSignal, DiscoveryInboxEntry } from "@/lib/shared/types/agent-identity";
import type { UnregisteredAgentActivity } from "@/lib/shared/types/runtime";

/**
 * IDENTITY-P0-12 (master P0-09) — Shadow AI: AI activity observed at
 * runtime from an agent nobody registered. Pure, so the evidence and
 * classification rules are unit-tested without a database.
 *
 * Each distinct agent reference Runtime quarantined as UNREGISTERED_AGENT
 * becomes one discovery-inbox entry in the "shadow_ai" category, keyed as
 * `runtime::<reference>` so the existing register / link / ignore flow
 * records its decision exactly like any other candidate. Registering it
 * links the reference as the new agent's identity, so that agent's next
 * events resolve and are recorded normally.
 *
 * Classification is deterministic and evidence-backed (#9): activity
 * submitted as an agent's runtime events is strong evidence of an AI
 * agent; tool calls and an MCP source add to it. Owner is never guessed:
 * telemetry does not say who owns an agent.
 */

export const RUNTIME_SOURCE = "runtime";
export const RUNTIME_SOURCE_NAME = "Runtime telemetry";

function list(values: string[], max = 5): string {
  return values.length > max ? `${values.slice(0, max).join(", ")} +${values.length - max} more` : values.join(", ");
}

export function shadowAiEntry(
  activity: UnregisteredAgentActivity,
  decision: { status: string; matchedAgentId: string | null } | undefined,
): DiscoveryInboxEntry {
  const signals: DetectionSignal[] = [
    {
      signal: "Runtime activity from an unregistered agent",
      source: RUNTIME_SOURCE_NAME,
      observedValue: `${activity.eventCount} event${activity.eventCount === 1 ? "" : "s"} via ${list(activity.sources) || "unknown source"}`,
      strength: "strong",
      scoreContribution: 60,
    },
  ];
  if (activity.tools.length > 0) {
    signals.push({ signal: "Tool calls", source: RUNTIME_SOURCE_NAME, observedValue: list(activity.tools), strength: "medium", scoreContribution: 15 });
  }
  if (activity.sources.includes("mcp")) {
    signals.push({ signal: "MCP runtime source", source: RUNTIME_SOURCE_NAME, observedValue: "mcp", strength: "medium", scoreContribution: 10 });
  }
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.scoreContribution, 0));
  const confidenceLevel = score >= 80 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW";

  return {
    externalId: activity.agentRef,
    integrationId: RUNTIME_SOURCE,
    integrationName: RUNTIME_SOURCE_NAME,
    sourceSystem: RUNTIME_SOURCE,
    displayName: activity.agentRef,
    identityType: "workload_identity",
    owner: null,
    application: activity.applications[0] ?? null,
    category: "shadow_ai",
    // Strong evidence at HIGH confidence is a confirmed agent; otherwise probable.
    classification: confidenceLevel === "HIGH" ? "CONFIRMED_AGENT" : "PROBABLE_AGENT",
    confidenceScore: score,
    confidenceLevel,
    signals,
    changeType: "NEW",
    candidateStatus: decision ? (decision.status === "linked" ? "linked" : "ignored") : "open",
    linkedAgentId: decision?.status === "linked" ? (decision.matchedAgentId ?? undefined) : undefined,
    lastSeenAt: activity.lastSeenAt,
    // Shown as the candidate's source evidence. Counts and names only:
    // quarantine never stores the raw event payload.
    raw: {
      events: activity.eventCount,
      firstSeenAt: activity.firstSeenAt,
      lastSeenAt: activity.lastSeenAt,
      sources: activity.sources,
      applications: activity.applications,
      tools: activity.tools,
      actions: activity.actions,
    },
  };
}
