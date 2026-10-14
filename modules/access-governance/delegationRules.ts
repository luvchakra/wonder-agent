/**
 * ACCESS-P0-23 (design §5.3, "approver delegation") — pure (#9). A member
 * hands their approvals to another member for a time (out of office, or a
 * standing arrangement). The delegate then decides the steps that name the
 * delegator, on their behalf; every decision records both. A delegation is
 * time-limited, never to oneself, and never lets anyone decide a request
 * they made or that is for them (the approval engine checks that for the
 * person deciding, whoever they act for).
 */

export const DELEGATION_SCOPES = ["approvals"] as const;
export type DelegationScope = (typeof DELEGATION_SCOPES)[number];
/** The longest a delegation may run. */
export const MAX_DELEGATION_DAYS = 180;

export type DelegationInput = { delegatorUserId?: unknown; delegateUserId?: unknown; startsAt?: unknown; endsAt?: unknown; reason?: unknown };
export type ValidDelegation = { delegator_user_id: string; delegate_user_id: string; scope: DelegationScope; starts_at: string; ends_at: string; reason: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A new delegation: by default the caller's own approvals, from now; only
 * someone who manages access may set one for another person.
 */
export function validateDelegation(input: DelegationInput, caller: { userId: string; canManageAccess: boolean }, now: Date): ValidDelegation | { error: string; status?: number } {
  const delegator = input.delegatorUserId === undefined || input.delegatorUserId === null || input.delegatorUserId === "" ? caller.userId : input.delegatorUserId;
  if (typeof delegator !== "string" || !UUID_RE.test(delegator)) return { error: "delegatorUserId: a member" };
  if (delegator !== caller.userId && !caller.canManageAccess) return { error: "Only an access manager can delegate someone else's approvals", status: 403 };
  if (typeof input.delegateUserId !== "string" || !UUID_RE.test(input.delegateUserId)) return { error: "delegateUserId: the member who decides instead" };
  if (input.delegateUserId === delegator) return { error: "delegateUserId: someone other than the person away" };
  const start = input.startsAt ? new Date(String(input.startsAt)) : now;
  const end = new Date(String(input.endsAt ?? ""));
  if (Number.isNaN(start.getTime())) return { error: "startsAt: a date" };
  if (Number.isNaN(end.getTime())) return { error: "endsAt: when it ends" };
  if (end.getTime() <= Math.max(start.getTime(), now.getTime())) return { error: "endsAt: after it starts, and in the future" };
  if (end.getTime() - start.getTime() > MAX_DELEGATION_DAYS * 86_400_000) return { error: `A delegation lasts at most ${MAX_DELEGATION_DAYS} days` };
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 500) : null;
  return { delegator_user_id: delegator, delegate_user_id: input.delegateUserId, scope: "approvals", starts_at: start.toISOString(), ends_at: end.toISOString(), reason };
}

/** In force now: started, not ended, not revoked. */
export function isActive(d: { startsAt: string; endsAt: string; revokedAt: string | null }, now: Date): boolean {
  return !d.revokedAt && Date.parse(d.startsAt) <= now.getTime() && Date.parse(d.endsAt) > now.getTime();
}

/** The people whose approvals this member may decide now. */
export function actingFor(delegations: { delegatorUserId: string; delegateUserId: string; startsAt: string; endsAt: string; revokedAt: string | null }[], userId: string, now: Date): string[] {
  return [...new Set(delegations.filter((d) => d.delegateUserId === userId && isActive(d, now)).map((d) => d.delegatorUserId))];
}
