/**
 * ACCESS-P0-29 — pure rules (#9) for fulfilment tasks. The service
 * (fulfilmentTasks.ts) loads and writes.
 */

export const FULFILMENT_TASK_STATUSES = ["open", "claimed", "completed", "failed", "verified", "cancelled"] as const;
export type FulfilmentTaskStatus = (typeof FULFILMENT_TASK_STATUSES)[number];
export type FulfilmentTaskAction = "claim" | "complete" | "fail";
/** ACCESS-P0-30: what the task asks for on the target. */
export type FulfilmentTaskKind = "grant" | "remove" | "create_account" | "disable_account";

/** Where each action may start, and where it ends. A failed task can be claimed again and retried. */
const FROM: Record<FulfilmentTaskAction, { from: FulfilmentTaskStatus[]; to: FulfilmentTaskStatus }> = {
  claim: { from: ["open", "failed"], to: "claimed" },
  complete: { from: ["open", "claimed"], to: "completed" },
  fail: { from: ["open", "claimed"], to: "failed" },
};

/**
 * Whether `actor` may take `action` on a task in `status`. Someone who can
 * approve access may always act; otherwise only the task's assignee. Once
 * claimed, only the claimer (or an approver) completes or fails it.
 */
export function canAct(
  task: { status: FulfilmentTaskStatus; assigneeIdentityId: string | null; claimedBy: string | null },
  actor: { userId: string; identityId: string | null; canApprove: boolean },
  action: FulfilmentTaskAction,
): { ok: true; to: FulfilmentTaskStatus } | { ok: false; code: string; message: string } {
  const rule = FROM[action];
  if (!rule.from.includes(task.status)) return { ok: false, code: "INVALID_TRANSITION", message: `A task that is ${task.status} cannot be ${action === "claim" ? "claimed" : action === "complete" ? "completed" : "failed"}` };
  const assignee = actor.identityId !== null && actor.identityId === task.assigneeIdentityId;
  if (!actor.canApprove && !assignee) return { ok: false, code: "FORBIDDEN", message: "Only the task's owner or an access manager can work on it" };
  if (task.status === "claimed" && action !== "claim" && task.claimedBy !== actor.userId && !actor.canApprove) {
    return { ok: false, code: "FORBIDDEN", message: "Someone else has claimed this task" };
  }
  return { ok: true, to: rule.to };
}

/** Due this many days after it opens. */
export function dueAt(openedAt: Date, slaDays: number): string {
  return new Date(openedAt.getTime() + slaDays * 86_400_000).toISOString();
}

/** Still to do and past its due time. */
export function isOverdue(task: { status: FulfilmentTaskStatus; dueAt: string }, now = new Date()): boolean {
  return (task.status === "open" || task.status === "claimed" || task.status === "failed") && Date.parse(task.dueAt) < now.getTime();
}

/** Overdue and not reminded in the last day. */
export function needsReminder(task: { status: FulfilmentTaskStatus; dueAt: string; remindedAt: string | null }, now = new Date()): boolean {
  return isOverdue(task, now) && (!task.remindedAt || now.getTime() - Date.parse(task.remindedAt) >= 86_400_000);
}
