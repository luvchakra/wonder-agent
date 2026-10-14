import { isOverdue, type FulfilmentTaskStatus } from "./fulfilmentTaskRules";

/**
 * ACCESS-P0-42 (owner request 2026-10-14) — internal fulfilment task
 * assignment, pure (#9): who a new task goes to, who may hand a task on,
 * and each assignee's workload. The service (fulfilmentTasks.ts and
 * fulfilmentAssignments.ts) loads and writes.
 */

export type Assignee = { identityId: string | null; groupId: string | null };
export type AssignmentRow = { entitlementType: string | null } & Assignee;
export type AssigneeSource = "entitlement_type" | "application" | "technical_owner" | "business_owner" | "none";

/**
 * Who a new task goes to: the row for the entitlement's type, else the
 * application's row, else the technical owner, then the business owner.
 * No one means the access managers see it (today's route).
 */
export function resolveAssignee(
  rows: AssignmentRow[],
  entitlementType: string | null,
  owners: { technicalOwnerIdentityId: string | null; businessOwnerIdentityId: string | null },
): Assignee & { source: AssigneeSource } {
  const type = entitlementType?.trim().toLowerCase() || null;
  const byType = type ? rows.find((r) => r.entitlementType?.trim().toLowerCase() === type) : undefined;
  if (byType) return { identityId: byType.identityId, groupId: byType.groupId, source: "entitlement_type" };
  const app = rows.find((r) => !r.entitlementType);
  if (app) return { identityId: app.identityId, groupId: app.groupId, source: "application" };
  if (owners.technicalOwnerIdentityId) return { identityId: owners.technicalOwnerIdentityId, groupId: null, source: "technical_owner" };
  if (owners.businessOwnerIdentityId) return { identityId: owners.businessOwnerIdentityId, groupId: null, source: "business_owner" };
  return { identityId: null, groupId: null, source: "none" };
}

/** Whether the actor is the task's assignee: the person named, or a member of the group named. */
export function isAssignee(task: { assigneeIdentityId: string | null; assigneeGroupId?: string | null }, actor: { identityId: string | null; groupIds?: string[] }): boolean {
  if (actor.identityId !== null && actor.identityId === task.assigneeIdentityId) return true;
  return !!task.assigneeGroupId && (actor.groupIds ?? []).includes(task.assigneeGroupId);
}

const REASSIGNABLE: FulfilmentTaskStatus[] = ["open", "claimed", "failed"];

/**
 * Who may hand a task on: its assignee (a group member for a group's task),
 * whoever claimed it, or an access manager; only while it is still to do.
 */
export function canReassign(
  task: { status: FulfilmentTaskStatus; assigneeIdentityId: string | null; assigneeGroupId: string | null; claimedBy: string | null },
  actor: { userId: string; identityId: string | null; groupIds: string[]; canApprove: boolean },
): { ok: true } | { ok: false; code: string; message: string } {
  if (!REASSIGNABLE.includes(task.status)) return { ok: false, code: "INVALID_TRANSITION", message: `A task that is ${task.status} cannot be reassigned` };
  if (actor.canApprove || task.claimedBy === actor.userId || isAssignee(task, actor)) return { ok: true };
  return { ok: false, code: "FORBIDDEN", message: "Only the task's assignee, whoever claimed it, or an access manager can reassign it" };
}

/** A reassignment names exactly one person or group, and says why. */
export function validateReassignment(input: { identityId?: unknown; groupId?: unknown; reason?: unknown }): { identityId: string | null; groupId: string | null; reason: string } | { error: string } {
  const id = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);
  const identityId = input.identityId ? id(input.identityId) : null;
  const groupId = input.groupId ? id(input.groupId) : null;
  if ((input.identityId && !identityId) || (input.groupId && !groupId)) return { error: "identityId or groupId: a person or a group of this organization" };
  if (!identityId === !groupId) return { error: "Name one person or one group" };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 2000) return { error: "reason: say why, in at most 2000 characters" };
  return { identityId, groupId, reason };
}

export type Workload = { key: string; identityId: string | null; groupId: string | null; open: number; claimed: number; failed: number; overdue: number };

/** Tasks still to do per assignee (person, group, or nobody), busiest first. */
export function workload(tasks: { status: FulfilmentTaskStatus; dueAt: string; assigneeIdentityId: string | null; assigneeGroupId: string | null }[], now = new Date()): Workload[] {
  const by = new Map<string, Workload>();
  for (const t of tasks) {
    if (!REASSIGNABLE.includes(t.status)) continue;
    const key = t.assigneeGroupId ? `group:${t.assigneeGroupId}` : t.assigneeIdentityId ? `identity:${t.assigneeIdentityId}` : "none";
    const w = by.get(key) ?? { key, identityId: t.assigneeGroupId ? null : t.assigneeIdentityId, groupId: t.assigneeGroupId, open: 0, claimed: 0, failed: 0, overdue: 0 };
    w[t.status as "open" | "claimed" | "failed"]++;
    if (isOverdue(t, now)) w.overdue++;
    by.set(key, w);
  }
  return [...by.values()].sort((a, b) => b.overdue - a.overdue || b.open + b.claimed + b.failed - (a.open + a.claimed + a.failed));
}
