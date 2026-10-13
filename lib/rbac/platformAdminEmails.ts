/**
 * Owner request (13 October 2026): who may open the vendor console can also
 * be set in the hosting environment, `PLATFORM_ADMIN_EMAILS`: a
 * comma-separated list of email addresses, in addition to the
 * `platform_admins` table. Pure, so the matching is tested on its own.
 *
 * A listed address counts only for an account whose email Supabase Auth has
 * confirmed (checked by the caller); a typed or unconfirmed address never
 * opens the console. Removing an address from the variable (and
 * redeploying) removes the access.
 */
export function parsePlatformAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
  );
}

/** Whether a confirmed account's email is on the list. */
export function isListedPlatformAdmin(list: ReadonlySet<string>, account: { email: string | null | undefined; emailConfirmedAt: string | null | undefined }): boolean {
  if (!account.email || !account.emailConfirmedAt) return false;
  return list.has(account.email.trim().toLowerCase());
}
