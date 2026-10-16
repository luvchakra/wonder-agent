/**
 * Where sign-in may send someone back to (owner request, 2026-10-16: the
 * help guide needs a session, and a signed-out visitor returns to the help
 * page they asked for). Only the help guide qualifies, so `next` can never
 * become an open redirect to another site or to an arbitrary page.
 */

/** A help page path: `/help`, `/help/…`, optionally with a query. */
export function isHelpPath(pathname: string): boolean {
  return pathname === "/help" || pathname.startsWith("/help/") || pathname.startsWith("/help?");
}

/** The `next` value sign-in accepts, or null. Rejects anything that is not a same-site help path. */
export function safeReturnTo(next: string | null | undefined): string | null {
  if (!next || next.length > 512) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  const path = next.split(/[?#]/)[0];
  return isHelpPath(path) ? next : null;
}
