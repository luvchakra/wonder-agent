/**
 * COMPLIANCE-P0-10 part 1 — reviews of people's access, pure (#9).
 *
 * Who reviews an item: the campaign's reviewer kind picks the identity's
 * manager or the application's owner; when that person is missing, cannot
 * sign in, or is the person whose access it is, the campaign's named
 * reviewer takes the item. Nobody is asked to certify their own access.
 */

export const REVIEWER_KINDS = ["named", "manager", "application_owner"] as const;
export type ReviewerKind = (typeof REVIEWER_KINDS)[number];

export function resolveReviewer(
  kind: ReviewerKind,
  people: { subjectUserId: string | null; managerUserId: string | null; applicationOwnerUserId: string | null },
  namedReviewerId: string,
): { reviewerId: string; fallback: boolean } {
  const chosen = kind === "manager" ? people.managerUserId : kind === "application_owner" ? people.applicationOwnerUserId : namedReviewerId;
  if (chosen && chosen !== people.subjectUserId) return { reviewerId: chosen, fallback: false };
  return { reviewerId: namedReviewerId, fallback: kind !== "named" };
}

/** A reviewer never keeps their own access (certify or exception); revoking it is always allowed. */
export function selfCertificationRefused(decision: string, reviewerId: string, subjectUserId: string | null): boolean {
  return (decision === "approve" || decision === "exception") && subjectUserId !== null && reviewerId === subjectUserId;
}

/** The decisions on a person's access or WonderID role (part 2 adds defer, escalate and exception). */
export const IDENTITY_ITEM_DECISIONS = ["approve", "revoke", "defer", "escalate", "exception", "delegate", "request_information"] as const;

/** Part 2: how far ahead a deferral and an exception may run. */
export const MAX_DEFER_DAYS = 30;
export const MAX_EXCEPTION_DAYS = 90;

/**
 * The date a defer or an exception runs to: required for those two, in the
 * future, and no further than their limit. Anything else takes no date.
 */
export function validateUntil(decision: string, until: unknown, now: Date): { until: string | null } | { error: string } {
  if (decision !== "defer" && decision !== "exception") return { until: null };
  if (typeof until !== "string" || !until.trim()) return { error: `until: the date the ${decision === "defer" ? "review is deferred" : "exception ends"} to` };
  const t = new Date(until);
  if (Number.isNaN(t.getTime())) return { error: "until: a date" };
  if (t.getTime() <= now.getTime()) return { error: "until: a date in the future" };
  const days = decision === "defer" ? MAX_DEFER_DAYS : MAX_EXCEPTION_DAYS;
  if (t.getTime() > now.getTime() + days * 86_400_000) return { error: `until: at most ${days} days ahead` };
  return { until: t.toISOString() };
}

/** Escalation goes to whoever launched the campaign; never back to the person escalating. */
export function escalationTarget(campaignCreatorId: string | null, actorId: string): string | null {
  return campaignCreatorId && campaignCreatorId !== actorId ? campaignCreatorId : null;
}
