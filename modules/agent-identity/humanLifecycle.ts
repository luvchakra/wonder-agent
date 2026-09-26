import type { HumanLifecycleState, IdentityStatus, LifecycleEventType, LifecycleTaskType, SourcedFields } from "@/lib/shared/types/agent-identity";

/**
 * IDENTITY-P0-18 — the human lifecycle, pure (#9): which transitions a
 * person may make, which lifecycle events a change amounts to, and the
 * governed work each event opens. The service records events and tasks;
 * a task is a person's job, never an automatic grant or revocation (#15).
 */

/** Manual transitions a person may make, and the event each one is. */
export const HUMAN_TRANSITIONS: Record<HumanLifecycleState, Partial<Record<HumanLifecycleState, LifecycleEventType>>> = {
  PRE_JOIN: { ACTIVE: "joiner", ARCHIVED: "hire_cancelled" },
  ACTIVE: { LEAVE_PENDING: "leaver", DISABLED: "disabled" },
  LEAVE_PENDING: { ACTIVE: "leaver_cancelled", DISABLED: "disabled" },
  DISABLED: { ACTIVE: "rehire", TERMINATED: "terminated" },
  TERMINATED: { ACTIVE: "rehire", ARCHIVED: "archived" },
  ARCHIVED: { ACTIVE: "rehire" },
};

export function allowedTransitions(from: HumanLifecycleState | null): HumanLifecycleState[] {
  return from ? (Object.keys(HUMAN_TRANSITIONS[from] ?? {}) as HumanLifecycleState[]) : [];
}

/**
 * The identity status a lifecycle state implies. LEAVE_PENDING keeps the
 * current status: someone serving notice still works, while a person a
 * source reported gone is already inactive.
 */
export function statusForState(state: HumanLifecycleState, current: IdentityStatus): IdentityStatus {
  switch (state) {
    case "PRE_JOIN":
      return "pending";
    case "ACTIVE":
      return "active";
    case "LEAVE_PENDING":
      return current;
    case "DISABLED":
      return "disabled";
    case "TERMINATED":
      return "terminated";
    case "ARCHIVED":
      return "archived";
  }
}

const MOVER_FIELDS = ["department", "title", "businessUnit", "location"] as const;
const GONE = new Set<HumanLifecycleState>(["LEAVE_PENDING", "DISABLED", "TERMINATED", "ARCHIVED"]);

export type DetectedEvent = { eventType: LifecycleEventType; changedFields: string[]; fromState: HumanLifecycleState | null; toState: HumanLifecycleState | null };

/**
 * What a sourced change to a person amounts to. `before` is null for a new
 * identity. A person who is gone does not "move"; a returning person is a
 * rehire; a joiner whose start date arrives only changes state.
 */
export function detectLifecycleEvents(
  before: (SourcedFields & { lifecycleState: HumanLifecycleState | null }) | null,
  after: SourcedFields & { lifecycleState: HumanLifecycleState | null },
): DetectedEvent[] {
  const to = after.lifecycleState;
  if (!before) return [{ eventType: "joiner", changedFields: [], fromState: null, toState: to }];
  const from = before.lifecycleState;
  const events: DetectedEvent[] = [];
  if (from !== to && to) {
    if (from === "PRE_JOIN" && to === "ACTIVE") events.push({ eventType: "joiner", changedFields: ["lifecycleState"], fromState: from, toState: to });
    else if (from === "LEAVE_PENDING" && to === "ACTIVE") events.push({ eventType: "leaver_cancelled", changedFields: ["lifecycleState"], fromState: from, toState: to });
    else if (from && GONE.has(from) && to === "ACTIVE") events.push({ eventType: "rehire", changedFields: ["lifecycleState"], fromState: from, toState: to });
    else if ((from === "ACTIVE" || from === "PRE_JOIN") && GONE.has(to)) events.push({ eventType: "leaver", changedFields: ["lifecycleState"], fromState: from, toState: to });
    else if (to === "TERMINATED") events.push({ eventType: "terminated", changedFields: ["lifecycleState"], fromState: from, toState: to });
    else if (to === "ARCHIVED") events.push({ eventType: "archived", changedFields: ["lifecycleState"], fromState: from, toState: to });
    else if (to === "DISABLED") events.push({ eventType: "disabled", changedFields: ["lifecycleState"], fromState: from, toState: to });
  }
  const working = to === "ACTIVE" || to === "PRE_JOIN";
  const changed = (f: keyof SourcedFields) => after[f] !== undefined && (after[f] ?? null) !== (before[f] ?? null);
  if (working) {
    const moved = MOVER_FIELDS.filter((f) => changed(f));
    if (moved.length) events.push({ eventType: "mover", changedFields: [...moved], fromState: from, toState: to });
    // A first manager is an assignment, not a change (a joiner's manager
    // is often resolved later in the same run).
    else if (changed("managerIdentityId") && (before.managerIdentityId ?? null) !== null) {
      events.push({ eventType: "manager_change", changedFields: ["managerIdentityId"], fromState: from, toState: to });
    }
    if (changed("employmentType") || changed("subtype")) {
      events.push({ eventType: "conversion", changedFields: (["employmentType", "subtype"] as const).filter((f) => changed(f)), fromState: from, toState: to });
    }
  }
  return events;
}

/**
 * The governed work an event opens. Each task is done by a person (or a
 * later governed workflow) and closed with a note; none of them grants or
 * revokes anything on its own.
 */
export function tasksForEvent(eventType: LifecycleEventType, ctx: { hasSignIn: boolean }): LifecycleTaskType[] {
  switch (eventType) {
    case "joiner":
      return ["request_baseline_access"];
    case "mover":
    case "conversion":
      return ["review_access"];
    case "rehire":
      return ["review_access", "request_baseline_access"];
    case "leaver":
      return ["transfer_ownership", "revoke_access", ...(ctx.hasSignIn ? (["disable_sign_in"] as const) : [])];
    default:
      return [];
  }
}
