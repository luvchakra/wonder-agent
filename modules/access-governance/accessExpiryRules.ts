/**
 * ACCESS-P0-32 — pure rules (#9) for time-bound access. The service
 * (accessExpiry.ts) loads and writes.
 */

const DAY = 86_400_000;

/** The end date has come: the approval no longer holds the access. */
export function hasEnded(expiresAt: string | null, now = new Date()): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= now.getTime();
}

/** Ends within the reminder window and has not been reminded yet (one reminder per request). */
export function expiryReminderDue(expiresAt: string | null, remindedAt: string | null, reminderDays: number, now = new Date()): boolean {
  if (expiresAt === null || remindedAt !== null || hasEnded(expiresAt, now)) return false;
  return Date.parse(expiresAt) - now.getTime() <= reminderDays * DAY;
}
