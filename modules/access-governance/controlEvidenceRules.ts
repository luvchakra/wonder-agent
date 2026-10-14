/**
 * COMPLIANCE-P0-14 part 2 — control evidence, pure (#9): whether a removal
 * is really done, and whether it was done in time.
 */

export type RemovalOutcome = "verified" | "removed_unverified" | "pending" | "failed";

/**
 * A removal request's outcome from its grants and tasks: verified once every
 * grant it names is revoked (a read of the system no longer finds it);
 * removed but not yet seen at the source; failed when a task says so;
 * otherwise still pending.
 */
export function removalOutcome(grants: { revokedAt: string | null; removalStatus: string | null }[], tasks: { status: string }[]): RemovalOutcome {
  if (grants.length && grants.every((g) => g.revokedAt !== null)) return "verified";
  if (tasks.some((t) => t.status === "failed")) return "failed";
  const live = grants.filter((g) => g.revokedAt === null);
  if (live.length && live.every((g) => g.removalStatus === "removed_unverified")) return "removed_unverified";
  return "pending";
}

export type SlaOutcome = "on_time" | "late" | "overdue" | "open" | "failed";

/**
 * A removal task against its due date: done on time or late (done is the
 * person's "done", or the read that confirmed it, whichever came first);
 * still open (overdue once the due date passed); or failed.
 */
export function slaOutcome(task: { status: string; dueAt: string; doneAt: string | null }, now: Date): SlaOutcome {
  if (task.status === "failed") return "failed";
  if ((task.status === "completed" || task.status === "verified") && task.doneAt) return new Date(task.doneAt) <= new Date(task.dueAt) ? "on_time" : "late";
  return new Date(task.dueAt) < now ? "overdue" : "open";
}
