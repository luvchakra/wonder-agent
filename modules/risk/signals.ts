import type { AgentApiKey } from "@/lib/shared/types/foundation";
import type { AgentRelationship } from "@/lib/shared/types/agent-identity";
import type { AccessGrant } from "@/lib/shared/types/access-governance";
import type { RuntimeEvent } from "@/lib/shared/types/runtime";
import type { EvidenceType, RogueCategory } from "@/lib/shared/types/risk";

/**
 * RISK-P0-12 (master P0-20/P0-21) — new deterministic risk signals, pure
 * so each rule is unit-tested on its own (#9: no model anywhere here).
 * Each consumes another module's published contract through
 * evaluateAgentRisk(); nothing here reads a table.
 */

export type SignalTrigger = {
  category: RogueCategory;
  title: string;
  explanation: string;
  recommendation: string;
  evidence: { evidenceType: EvidenceType; referenceId: string; summary: string }[];
};

/** Lifecycle states in which a delegate is not a governed, operating agent. */
const UNGOVERNED_STATES = new Set(["DISCOVERED", "SUSPENDED", "RETIRED"]);

/**
 * Suspicious delegation, from Identity's agent_relationships:
 * - sharing a credential with another agent (every agent must have its own
 *   identity to be governed and attributed), or
 * - delegating to or orchestrating an agent that is not governed: never
 *   registered (DISCOVERED), SUSPENDED or RETIRED.
 */
export function suspiciousDelegation(
  agentName: string,
  relationships: AgentRelationship[],
  related: Map<string, { name: string; lifecycleState: string }>,
): SignalTrigger | null {
  const hits: Array<{ rel: AgentRelationship; why: string }> = [];
  for (const rel of relationships) {
    const other = related.get(rel.relatedAgentId);
    const otherName = other?.name ?? "an unknown agent";
    if (rel.relationshipType === "shares_credential_with") {
      hits.push({ rel, why: `shares a credential with ${otherName}` });
    } else if ((rel.relationshipType === "delegates_to" || rel.relationshipType === "orchestrates") && (!other || UNGOVERNED_STATES.has(other.lifecycleState))) {
      const verb = rel.relationshipType === "delegates_to" ? "delegates to" : "orchestrates";
      hits.push({ rel, why: `${verb} ${otherName}${other ? `, which is ${other.lifecycleState.toLowerCase()}` : ""}` });
    }
  }
  if (hits.length === 0) return null;
  return {
    category: "suspicious_delegation",
    title: `${agentName} has suspicious delegation`,
    explanation: `${agentName} ${hits.map((h) => h.why).join("; ")}.`,
    recommendation: "Give each agent its own credential, and remove delegation to agents that are not registered and operating.",
    evidence: hits.map((h) => ({ evidenceType: "agent_relationship", referenceId: h.rel.id, summary: `${h.rel.relationshipType.replace(/_/g, " ")} → ${related.get(h.rel.relatedAgentId)?.name ?? h.rel.relatedAgentId}` })),
  };
}

/**
 * Unapproved tool use (SHOULD tools vs DID): Runtime's comparison already
 * lists tools used outside the contract's allowed tools. Evidence is the
 * newest recorded event that used each tool.
 */
export function unapprovedToolUse(agentName: string, unapprovedTools: string[], events: RuntimeEvent[], allowedTools: string[]): SignalTrigger | null {
  const tools = [...new Set(unapprovedTools)];
  if (tools.length === 0) return null;
  const evidence = tools.flatMap((tool) => {
    const e = events.find((ev) => ev.tool && ev.tool.toLowerCase() === tool.toLowerCase());
    return e ? [{ evidenceType: "runtime_event" as const, referenceId: e.id, summary: `${tool} at ${e.eventTime}` }] : [];
  });
  return {
    category: "unapproved_tool_use",
    title: `${agentName} used tools outside its contract`,
    explanation: `${agentName} used ${tools.join(", ")}, which ${tools.length === 1 ? "is" : "are"} not among its approved tools (${allowedTools.join(", ") || "none"}).`,
    recommendation: "Confirm whether these tools are needed; if not, remove the agent's access to them, or add them to its contract through review.",
    evidence,
  };
}

const ROTATION_DAYS = 90;
const MAX_ACTIVE_KEYS = 3;

/**
 * Credential health of the agent's own runtime credentials (its Runtime
 * Gateway API keys): unhealthy when an active key is older than 90 days
 * with no expiry (rotation overdue), or when more than 3 keys are active
 * at once (sprawl).
 */
export function credentialHealth(keys: AgentApiKey[], now: Date): { unhealthy: boolean; reasons: string[] } {
  const active = keys.filter((k) => k.status === "active");
  const reasons: string[] = [];
  const stale = active.filter((k) => !k.expiresAt && now.getTime() - new Date(k.createdAt).getTime() > ROTATION_DAYS * 24 * 60 * 60 * 1000);
  if (stale.length > 0) reasons.push(`${stale.length} active key(s) older than ${ROTATION_DAYS} days with no expiry`);
  if (active.length > MAX_ACTIVE_KEYS) reasons.push(`${active.length} active keys (more than ${MAX_ACTIVE_KEYS})`);
  return { unhealthy: reasons.length > 0, reasons };
}

const DESTRUCTIVE_VERBS = new Set(["delete", "drop", "purge", "truncate", "destroy", "wipe", "erase", "remove", "overwrite"]);

function leadingVerb(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").split(/[_\-.\s/:]+/)[0]?.toLowerCase() ?? "";
}

/**
 * Destructive capability (CAN): the agent holds an entitlement whose name
 * starts with a destructive verb, or an MCP tool permission for a tool its
 * MCP server declares destructive (INTEGRATION-P0-06's inventory).
 */
export function destructiveCapability(effectiveAccess: AccessGrant[], destructiveMcpTools: Set<string>): { present: boolean; names: string[] } {
  const names = new Set<string>();
  for (const g of effectiveAccess) {
    const name = g.entitlementName ?? "";
    if (!name) continue;
    if (DESTRUCTIVE_VERBS.has(leadingVerb(name))) names.add(name);
    else if (g.grantType === "mcp_tool_permission" && destructiveMcpTools.has(name.toLowerCase())) names.add(name);
  }
  return { present: names.size > 0, names: [...names].sort() };
}
