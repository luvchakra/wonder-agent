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

export type FulfilmentState = "pending_fulfilment" | "fulfilled_unverified" | "verified" | "untracked";

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
