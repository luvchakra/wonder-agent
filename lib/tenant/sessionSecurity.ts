/**
 * FOUNDATION-P0-09 — Session Security.
 *
 * Supabase Auth already provides JWT access-token expiry and refresh-token
 * rotation; this module adds the two controls it does not provide out of
 * the box: an idle timeout (force re-auth after inactivity) and an absolute
 * session lifetime (force re-auth after N hours regardless of activity),
 * enforced in proxy.ts on every request. Session-fixation is mitigated by
 * construction — Supabase issues a brand-new session (new access + refresh
 * tokens) on every successful sign-in; there is no pre-authentication
 * session identifier for an attacker to fixate.
 *
 * Both cookies are set once, at sign-in (see app/actions/auth.ts and
 * app/auth/callback/route.ts), and SESSION_LAST_SEEN_COOKIE is refreshed by
 * proxy.ts on every subsequent authenticated request.
 */
export const SESSION_STARTED_COOKIE = "wa_session_started_at";
export const SESSION_LAST_SEEN_COOKIE = "wa_session_last_seen";

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity
export const ABSOLUTE_SESSION_MAX_MS = 12 * 60 * 60 * 1000; // 12 hours from sign-in

export type SessionExpiryCheck = { expired: boolean; reason?: "idle" | "absolute" };

/**
 * Pure function (no cookie I/O) so it's unit-testable — proxy.ts reads the
 * two cookie values and calls this to decide whether to force sign-out.
 * Missing cookie values (e.g. a session established before this story
 * shipped) are treated as not-yet-expired rather than immediately forcing
 * sign-out — they get stamped on the next stampSessionCookies() call.
 */
export function checkSessionExpiry(
  startedAtMs: number | null,
  lastSeenMs: number | null,
  now: number = Date.now(),
): SessionExpiryCheck {
  if (startedAtMs !== null && now - startedAtMs > ABSOLUTE_SESSION_MAX_MS) {
    return { expired: true, reason: "absolute" };
  }
  if (lastSeenMs !== null && now - lastSeenMs > IDLE_TIMEOUT_MS) {
    return { expired: true, reason: "idle" };
  }
  return { expired: false };
}
