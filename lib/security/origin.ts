/**
 * FOUNDATION-P0-30 — a cross-site write guard for the JSON API, as defence
 * in depth on top of the session cookie's SameSite=Lax (FOUNDATION-P1-05).
 *
 * A browser always sends `Origin` on a cross-origin POST/PUT/PATCH/DELETE.
 * If one is present and names a different host from the one serving the
 * request, the write is refused before any route runs. A request without
 * `Origin` (a server-to-server call: webhooks, cron, connector receivers,
 * API clients) is not a browser CSRF vector and is left to the route's own
 * authentication. Pure, so it is unit-tested.
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Routes called by third parties with their own credentials (signatures, bearer secrets, API keys). */
const EXEMPT_PREFIXES = ["/api/v1/billing/webhooks/", "/api/connect/", "/api/cron/"];

export function isCrossSiteApiWrite(input: { method: string; pathname: string; origin: string | null; host: string | null }): boolean {
  if (!WRITE_METHODS.has(input.method.toUpperCase())) return false;
  if (!input.pathname.startsWith("/api/")) return false;
  if (EXEMPT_PREFIXES.some((p) => input.pathname.startsWith(p))) return false;
  if (!input.origin) return false;
  if (input.origin === "null") return true;
  let originHost: string;
  try {
    originHost = new URL(input.origin).host.toLowerCase();
  } catch {
    return true;
  }
  return !input.host || originHost !== input.host.toLowerCase();
}
