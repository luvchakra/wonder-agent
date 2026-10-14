/**
 * ACCESS-P0-38 part 2 (design §5.3) — approve from e-mail, pure (#9). A
 * link sent to one approver opens the request page. It is single-use and
 * short-lived, and it decides nothing: the decision still needs the
 * approver's signed-in session and the approval engine's own checks.
 */

/** How long a link stays usable. */
export const APPROVAL_LINK_TTL_HOURS = 72;

export type LinkState = "valid" | "expired" | "used" | "not_yours" | "decided" | "unknown";

/** What opening a link means for the person signed in. */
export function approvalLinkState(
  link: { userId: string; requestId: string; expiresAt: string; usedAt: string | null } | null,
  context: { userId: string; requestId: string; requestStatus: string; now: Date },
): LinkState {
  if (!link || link.requestId !== context.requestId) return "unknown";
  if (link.userId !== context.userId) return "not_yours";
  if (link.usedAt) return "used";
  if (Date.parse(link.expiresAt) <= context.now.getTime()) return "expired";
  if (context.requestStatus !== "pending") return "decided";
  return "valid";
}

/** What the page says about the link. */
export const LINK_MESSAGE: Record<LinkState, string> = {
  valid: "Opened from your approval message. Decide below.",
  expired: "That approval link has expired. If this request still waits for you, decide below.",
  used: "That approval link was already used. If this request still waits for you, decide below.",
  not_yours: "That approval link was sent to someone else.",
  decided: "This request has already been decided.",
  unknown: "That approval link is not valid.",
};

/** The page an approver's link opens; the token travels in the query string and is checked on arrival. */
export function approvalLinkPath(requestId: string, token: string): string {
  return `/access/requests/${requestId}?${new URLSearchParams({ link: token }).toString()}`;
}

/** A link token: 43 URL-safe characters (32 random bytes). */
export function isLinkToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}
