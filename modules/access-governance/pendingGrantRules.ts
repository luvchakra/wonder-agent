/**
 * ACCESS-P0-28 — pure rules (#9) for turning an approved request into a
 * pending grant. The service (pendingGrants.ts) loads and writes.
 */

export type SubjectAccount = { id: string; status: string };

/**
 * Which account of the subject on the application holds the requested
 * grant: its one real account; else the placeholder a request already
 * made; else a new placeholder. Several real accounts are ambiguous: the
 * request does not pick one (§17.6), and nothing is created.
 */
export function chooseAccount(accounts: SubjectAccount[]): { kind: "existing"; accountId: string } | { kind: "create" } | { kind: "ambiguous"; count: number } {
  const real = accounts.filter((a) => a.status !== "pending");
  if (real.length > 1) return { kind: "ambiguous", count: real.length };
  if (real.length === 1) return { kind: "existing", accountId: real[0].id };
  const placeholder = accounts.find((a) => a.status === "pending");
  return placeholder ? { kind: "existing", accountId: placeholder.id } : { kind: "create" };
}

/** The placeholder account's reference, unique per subject and application. */
export function placeholderRef(subject: { identityId: string | null; agentId: string | null }): string {
  return `pending:${subject.identityId ?? `agent:${subject.agentId}`}`;
}

export type FulfilmentState = "pending_fulfilment" | "failed" | "fulfilled_unverified" | "verified" | "untracked";

/**
 * A request's fulfilment, from its grants: verified only when every grant
 * is; otherwise the least advanced one. An approved request with no grant
 * (the subject has several accounts, or a failure was audited) is untracked.
 */
export function requestFulfilment(grants: { fulfilmentStatus: string; revokedAt: string | null }[]): FulfilmentState {
  const live = grants.filter((g) => g.revokedAt === null);
  if (!live.length) return "untracked";
  if (live.some((g) => g.fulfilmentStatus === "pending_fulfilment")) return "pending_fulfilment";
  if (live.some((g) => g.fulfilmentStatus === "fulfilled_unverified")) return "fulfilled_unverified";
  return "verified";
}

/**
 * ACCESS-P0-30: a request's progress from its fulfilment tasks (every kind
 * of request has them): still to do (or failed), done but not yet seen at
 * the source, or verified. With no task (a request older than tasks, or access that
 * already existed), its grants decide.
 */
export function requestProgress(
  tasks: { status: string }[],
  grants: { fulfilmentStatus: string; revokedAt: string | null }[],
): FulfilmentState {
  const live = tasks.filter((t) => t.status !== "cancelled");
  if (!live.length) return requestFulfilment(grants);
  // EXPERIENCE-P0-29: a task reported failed is shown as such until someone takes it up again.
  if (live.some((t) => t.status === "failed")) return "failed";
  if (live.some((t) => t.status === "open" || t.status === "claimed")) return "pending_fulfilment";
  if (live.some((t) => t.status === "completed")) return "fulfilled_unverified";
  return "verified";
}
