/**
 * ACCESS-P0-35 part 1 — approved changes to governance objects, pure (#9).
 * Owner decision (2026-10-14): a change needs a second person only in an
 * organization with two or more active Tenant Administrators; with one, it
 * applies at once (and is still versioned). The second person is anyone
 * else who manages access; nobody approves their own change.
 */

export const FOUR_EYES_MIN_ADMINISTRATORS = 2;

export function fourEyesRequired(activeTenantAdministrators: number): boolean {
  return activeTenantAdministrators >= FOUR_EYES_MIN_ADMINISTRATORS;
}

export type FieldChange = { field: string; before: unknown; after: unknown };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What a proposal changes, field by field (only the fields it sets). */
export function diffFields(previous: Record<string, unknown> | null, proposed: Record<string, unknown>): FieldChange[] {
  return Object.keys(proposed)
    .sort()
    .filter((k) => !same(previous?.[k], proposed[k]))
    .map((k) => ({ field: k, before: previous ? (previous[k] ?? null) : null, after: proposed[k] ?? null }));
}

export type ChangeDecision = "approved" | "rejected";

/** Whether this person may decide the change now, and if not why. */
export function decisionRefusal(change: { status: string; requestedBy: string }, actorId: string, decision: unknown): { status: number; code: string; message: string } | null {
  if (decision !== "approved" && decision !== "rejected") return { status: 400, code: "VALIDATION_FAILED", message: "decision: approved or rejected" };
  if (change.status !== "pending") return { status: 409, code: "INVALID_TRANSITION", message: `The change is ${change.status}, not waiting` };
  if (change.requestedBy === actorId) return { status: 409, code: "SELF_APPROVAL", message: "Someone other than the person who proposed it decides" };
  return null;
}

/** An approval applies only to the version it was proposed against. */
export function isStale(baseVersion: number | null, currentVersion: number | null): boolean {
  return (baseVersion ?? null) !== (currentVersion ?? null);
}
