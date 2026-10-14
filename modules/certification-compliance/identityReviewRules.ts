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

/** A reviewer never certifies their own access; revoking it is always allowed. */
export function selfCertificationRefused(decision: string, reviewerId: string, subjectUserId: string | null): boolean {
  return decision === "approve" && subjectUserId !== null && reviewerId === subjectUserId;
}

/** Only these decisions apply to a person's access in this part. */
export const IDENTITY_ITEM_DECISIONS = ["approve", "revoke", "delegate", "request_information"] as const;
