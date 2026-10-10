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
 * The limits to apply. An organization's Global Configuration can shorten
 * them (my_session_policy(), migration 0116); nothing can lengthen them past
 * the two constants above, which stay the ceiling here as well.
 */
export type SessionLimits = { idleMs: number; absoluteMs: number };
export const GLOBAL_SESSION_LIMITS: SessionLimits = { idleMs: IDLE_TIMEOUT_MS, absoluteMs: ABSOLUTE_SESSION_MAX_MS };

/** Limits from an organization's policy (minutes idle, hours in all), never looser than the global ones. */
export function sessionLimitsFrom(policy: { idleMinutes?: unknown; maxHours?: unknown } | null | undefined): SessionLimits {
  const idle = Number(policy?.idleMinutes);
  const hours = Number(policy?.maxHours);
  return {
    idleMs: Number.isFinite(idle) && idle > 0 ? Math.min(idle * 60_000, IDLE_TIMEOUT_MS) : IDLE_TIMEOUT_MS,
    absoluteMs: Number.isFinite(hours) && hours > 0 ? Math.min(hours * 3_600_000, ABSOLUTE_SESSION_MAX_MS) : ABSOLUTE_SESSION_MAX_MS,
  };
}

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
  limits: SessionLimits = GLOBAL_SESSION_LIMITS,
): SessionExpiryCheck {
  const absoluteMs = Math.min(limits.absoluteMs, ABSOLUTE_SESSION_MAX_MS);
  const idleMs = Math.min(limits.idleMs, IDLE_TIMEOUT_MS);
  if (startedAtMs !== null && now - startedAtMs > absoluteMs) {
    return { expired: true, reason: "absolute" };
  }
  if (lastSeenMs !== null && now - lastSeenMs > idleMs) {
    return { expired: true, reason: "idle" };
  }
  return { expired: false };
}

/**
 * Whether a failed `auth.getUser()` means the auth server could not be
 * reached (a network failure or a server error) rather than that it
 * rejected the session. Either way the request gets no access (fail
 * closed); the difference is only what the user is told (CLAUDE.md §17.5):
 * "the sign-in service is unavailable", not "your session expired".
 */
export function isAuthServiceUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; status?: unknown };
  if (e.name === "AuthRetryableFetchError") return true;
  return typeof e.status === "number" && (e.status === 0 || e.status >= 500);
}
