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

/** Defaults; each organization can set its own (Global Configuration). */
export const ROTATION_DAYS = 90;
export const MAX_ACTIVE_KEYS = 3;

/**
 * Credential health of the agent's own runtime credentials (its Runtime
 * Gateway API keys): unhealthy when an active key is older than 90 days
 * with no expiry (rotation overdue), or when more than 3 keys are active
 * at once (sprawl).
 */
export function credentialHealth(
  keys: AgentApiKey[],
  now: Date,
  { rotationDays = ROTATION_DAYS, maxActiveKeys = MAX_ACTIVE_KEYS }: { rotationDays?: number; maxActiveKeys?: number } = {},
): { unhealthy: boolean; reasons: string[] } {
  const active = keys.filter((k) => k.status === "active");
  const reasons: string[] = [];
  const stale = active.filter((k) => !k.expiresAt && now.getTime() - new Date(k.createdAt).getTime() > rotationDays * 24 * 60 * 60 * 1000);
  if (stale.length > 0) reasons.push(`${stale.length} active key(s) older than ${rotationDays} days with no expiry`);
  if (active.length > maxActiveKeys) reasons.push(`${active.length} active keys (more than ${maxActiveKeys})`);
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

/** WID-C03: how long before an observed action its gateway decision may have been asked, and how much clock skew is allowed after it. */
export const BYPASS_WINDOW_BEFORE_MS = 15 * 60_000;
export const BYPASS_WINDOW_AFTER_MS = 2 * 60_000;
const OBSERVED = new Set(["TOOL_EXECUTED", "API_CALL", "DATA_ACCESS", "DELEGATION"]);
const same = (a: string | null, b: string | null) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/**
 * WID-C03: gateway bypass. Once an agent asks the Runtime Gateway before
 * it acts, an action observed from another source (MCP, REST, webhook)
 * with no matching gateway decision shortly before it went around the
 * gateway. One that did proceed although its decision was DENY ignored
 * the gateway. A decision matches on the tool, or, without a tool, on the
 * action and application. Actions before the agent's first gateway
 * decision are not judged: nothing was expected of it then. An agent
 * that never used the gateway is not judged at all.
 */
export function gatewayBypass(agentName: string, events: RuntimeEvent[]): SignalTrigger | null {
  const decisions = events.filter((e) => e.source === "gateway");
  if (!decisions.length) return null;
  const enrolledAt = Math.min(...decisions.map((d) => Date.parse(d.eventTime)));
  const observed = events.filter((e) => e.source !== "gateway" && OBSERVED.has(e.eventType) && Date.parse(e.eventTime) >= enrolledAt);
  const bypassed: { event: RuntimeEvent; why: string }[] = [];
  for (const e of observed) {
    const at = Date.parse(e.eventTime);
    const match = decisions.find((d) => {
      const t = Date.parse(d.eventTime);
      if (t < at - BYPASS_WINDOW_BEFORE_MS || t > at + BYPASS_WINDOW_AFTER_MS) return false;
      return e.tool ? same(d.tool, e.tool) : same(d.action, e.action) && same(d.application, e.application);
    });
    const what = e.tool ?? `${e.action}${e.application ? ` on ${e.application}` : ""}`;
    if (!match) bypassed.push({ event: e, why: `${what} with no gateway decision` });
    else if (match.raw?.decision === "DENY" && e.success) bypassed.push({ event: e, why: `${what} although the gateway said DENY` });
  }
  if (!bypassed.length) return null;
  const shown = bypassed.slice(0, 10);
  return {
    category: "gateway_bypass",
    title: `${agentName} acted without the Runtime Gateway`,
    explanation: `${agentName} uses the Runtime Gateway, but ${bypassed.length} recorded action${bypassed.length === 1 ? "" : "s"} did not follow a gateway decision: ${shown.map((b) => b.why).join("; ")}${bypassed.length > shown.length ? "; and more" : ""}. Only calls sent to the gateway are checked.`,
    recommendation: "Route every tool call through the gateway (and remove the agent's direct credentials to the target), or suspend the agent while you find the path it used.",
    evidence: shown.map((b) => ({ evidenceType: "runtime_event" as const, referenceId: b.event.id, summary: `${b.why} at ${b.event.eventTime}` })),
  };
}
