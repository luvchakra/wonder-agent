import { MAX_DELEGATION_DAYS } from "./delegationRules";

/**
 * ACCESS-P0-23 part 4 (owner decisions, 17 Oct 2026) — delegation to AI
 * agents. Pure (#9).
 * - A person lets an agent act for them, or an agent lets another agent act
 *   for it, for named actions (and, optionally, named applications), for at
 *   most 180 days.
 * - It takes effect only once an owner of the receiving agent approves it,
 *   never the person who asked (an access manager may decide when every
 *   owner is the asker, or the agent has none).
 * - At the Runtime Gateway, a request that says it acts on someone's behalf
 *   is held for approval unless an active delegation covers its action.
 */

export type AgentDelegationInput = {
  delegatorKind?: unknown;
  delegatorAgentId?: unknown;
  delegateAgentId?: unknown;
  actions?: unknown;
  applications?: unknown;
  days?: unknown;
  reason?: unknown;
};

export type ValidAgentDelegation = {
  delegator_kind: "user" | "agent";
  delegator_user_id: string | null;
  delegator_agent_id: string | null;
  delegate_agent_id: string;
  actions: string[];
  applications: string[];
  starts_at: string;
  ends_at: string;
  reason: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function list(raw: unknown, max: number): string[] | null {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\n]/) : raw === undefined || raw === null ? [] : null;
  if (!items) return null;
  const out = [...new Set(items.map((x) => String(x).trim()).filter(Boolean))];
  return out.length <= max && out.every((x) => x.length <= 200) ? out : null;
}

/** A person's own delegation, or one from an agent (whose ownership the service checks). */
export function validateAgentDelegation(input: AgentDelegationInput, callerUserId: string, now: Date): ValidAgentDelegation | { error: string } {
  const kind = input.delegatorKind === "agent" ? "agent" : input.delegatorKind === undefined || input.delegatorKind === "" || input.delegatorKind === "user" ? "user" : null;
  if (!kind) return { error: "delegatorKind: user or agent" };
  if (typeof input.delegateAgentId !== "string" || !UUID_RE.test(input.delegateAgentId)) return { error: "delegateAgentId: the agent that acts" };
  let delegatorAgent: string | null = null;
  if (kind === "agent") {
    if (typeof input.delegatorAgentId !== "string" || !UUID_RE.test(input.delegatorAgentId)) return { error: "delegatorAgentId: the agent it acts for" };
    if (input.delegatorAgentId === input.delegateAgentId) return { error: "An agent cannot delegate to itself" };
    delegatorAgent = input.delegatorAgentId;
  }
  const actions = list(input.actions, 50);
  if (!actions || actions.length === 0) return { error: "actions: at least one action the agent may take" };
  const applications = list(input.applications, 50);
  if (!applications) return { error: "applications: at most 50" };
  const days = Number(input.days ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DELEGATION_DAYS) return { error: `days: 1 to ${MAX_DELEGATION_DAYS}` };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return { error: "reason: say why" };
  return {
    delegator_kind: kind,
    delegator_user_id: kind === "user" ? callerUserId : null,
    delegator_agent_id: delegatorAgent,
    delegate_agent_id: input.delegateAgentId,
    actions,
    applications,
    starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + days * 86_400_000).toISOString(),
    reason: reason.slice(0, 1000),
  };
}

/** Who may approve or reject: an owner of the receiving agent who did not ask; failing that, an access manager who did not ask. */
export function delegationDecisionRefusal(
  row: { status: string; requestedBy: string },
  caller: { userId: string; canManageAccess: boolean },
  delegateOwners: string[],
): string | null {
  if (row.status !== "pending") return "This delegation has already been decided.";
  if (caller.userId === row.requestedBy) return "You asked for this delegation, so someone else decides it.";
  if (delegateOwners.includes(caller.userId)) return null;
  const ownerCanDecide = delegateOwners.some((o) => o !== row.requestedBy);
  if (!ownerCanDecide && caller.canManageAccess) return null;
  return "Only an owner of the agent can approve this delegation.";
}

export type OnBehalfOf = { kind: "user" | "agent"; id: string };

export type ActiveAgentDelegation = { delegatorKind: "user" | "agent"; delegatorId: string; actions: string[]; applications: string[]; startsAt: string; endsAt: string };

const norm = (v: string | undefined | null) => (v ?? "").trim().toLowerCase();

/** Whether an active delegation from `onBehalfOf` covers this action (and application, when the delegation names any). */
export function delegationCovers(delegations: ActiveAgentDelegation[], onBehalfOf: OnBehalfOf, request: { action: string; application?: string }, now: Date): boolean {
  return delegations.some(
    (d) =>
      d.delegatorKind === onBehalfOf.kind &&
      d.delegatorId === onBehalfOf.id &&
      Date.parse(d.startsAt) <= now.getTime() &&
      Date.parse(d.endsAt) > now.getTime() &&
      d.actions.some((a) => norm(a) === norm(request.action)) &&
      (d.applications.length === 0 || (!!request.application && d.applications.some((a) => norm(a) === norm(request.application)))),
  );
}

/**
 * The principal a gateway request says it acts for: `onBehalfOf: {kind, id}`.
 * A malformed one never matches a delegation, so it is held for approval.
 * The older `context.userId` stays free text and is not a claim of
 * delegation (it often names someone outside WonderID).
 */
export function parseOnBehalfOf(body: Record<string, unknown>): OnBehalfOf | undefined {
  const raw = body.onBehalfOf;
  if (raw === undefined || raw === null) return undefined;
  const r = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = r.kind ?? r.type;
  if ((kind === "user" || kind === "agent") && typeof r.id === "string" && UUID_RE.test(r.id)) return { kind, id: r.id };
  return { kind: "user", id: "invalid" };
}
