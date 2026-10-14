import { describe, expect, it } from "vitest";
import { chooseAccount, endedRemoval, placeholderRef, requestFulfilment, requestProgress } from "./pendingGrantRules";

describe("chooseAccount (ACCESS-P0-28)", () => {
  it("uses the subject's one real account, ahead of a placeholder", () => {
    expect(chooseAccount([{ id: "p", status: "pending" }, { id: "r", status: "active" }])).toEqual({ kind: "existing", accountId: "r" });
  });
  it("reuses the placeholder a request already made, else creates one", () => {
    expect(chooseAccount([{ id: "p", status: "pending" }])).toEqual({ kind: "existing", accountId: "p" });
    expect(chooseAccount([])).toEqual({ kind: "create" });
  });
  it("never picks between several real accounts", () => {
    expect(chooseAccount([{ id: "a", status: "active" }, { id: "b", status: "active" }])).toEqual({ kind: "ambiguous", count: 2 });
  });
  it("puts standard access on the one standard account beside an admin account, never privileged access", () => {
    const two = [
      { id: "std", status: "active", accountType: "standard" },
      { id: "adm", status: "active", accountType: "privileged" },
    ];
    expect(chooseAccount(two)).toEqual({ kind: "existing", accountId: "std" });
    expect(chooseAccount(two, { privilegedEntitlement: true })).toEqual({ kind: "ambiguous", count: 2 });
    expect(chooseAccount([...two, { id: "std2", status: "active", accountType: "standard" }])).toEqual({ kind: "ambiguous", count: 3 });
  });
  it("names the placeholder after the subject", () => {
    expect(placeholderRef({ identityId: "i1", agentId: null })).toBe("pending:i1");
    expect(placeholderRef({ identityId: null, agentId: "a1" })).toBe("pending:agent:a1");
  });
});

describe("requestFulfilment", () => {
  const g = (fulfilmentStatus: string, revokedAt: string | null = null) => ({ fulfilmentStatus, revokedAt });
  it("is the least advanced live grant, and verified only when all are", () => {
    expect(requestFulfilment([g("verified"), g("pending_fulfilment")])).toBe("pending_fulfilment");
    expect(requestFulfilment([g("verified"), g("fulfilled_unverified")])).toBe("fulfilled_unverified");
    expect(requestFulfilment([g("verified"), g("none")])).toBe("verified");
  });
  it("is untracked with no live grant", () => {
    expect(requestFulfilment([])).toBe("untracked");
    expect(requestFulfilment([g("pending_fulfilment", "2026-10-11T00:00:00Z")])).toBe("untracked");
  });
});

describe("requestProgress (ACCESS-P0-30)", () => {
  const t = (status: string) => ({ status });
  it("follows the request's tasks: to do, done but unverified, verified; cancelled ones do not count", () => {
    expect(requestProgress([t("verified"), t("claimed")], [])).toBe("pending_fulfilment");
    expect(requestProgress([t("completed"), t("verified")], [])).toBe("fulfilled_unverified");
    expect(requestProgress([t("verified"), t("cancelled")], [])).toBe("verified");
  });
  it("EXPERIENCE-P0-29: a failed task shows as failed until it is taken up again", () => {
    expect(requestProgress([t("failed"), t("open")], [])).toBe("failed");
    expect(requestProgress([t("claimed"), t("verified")], [])).toBe("pending_fulfilment");
  });
  it("falls back to the grants when the request has no task", () => {
    expect(requestProgress([], [{ fulfilmentStatus: "none", revokedAt: null }])).toBe("verified");
    expect(requestProgress([t("cancelled")], [])).toBe("untracked");
  });
});

describe("endedRemoval (WID-C02)", () => {
  const g = (fulfilmentStatus: string, removalStatus: string | null, revokedAt: string | null = null) => ({ fulfilmentStatus, removalStatus, revokedAt });
  const GONE = "2026-10-11T00:00:00Z";
  it("is pending while any grant is live and not marked removed, including before the sweep marks it", () => {
    expect(endedRemoval([g("verified", null)])).toBe("pending");
    expect(endedRemoval([g("verified", "pending_removal"), g("verified", "removed_unverified")])).toBe("pending");
  });
  it("is removed but not verified until a read of the system revokes every grant", () => {
    expect(endedRemoval([g("verified", "removed_unverified"), g("verified", "removed_unverified", GONE)])).toBe("removed_unverified");
  });
  it("is verified only when every grant is revoked", () => {
    expect(endedRemoval([g("verified", "removed_unverified", GONE), g("pending_fulfilment", null, GONE)])).toBe("verified");
  });
  it("tells withdrawn grants (never fulfilled) apart, and has nothing to say without grants", () => {
    expect(endedRemoval([g("pending_fulfilment", null, GONE)])).toBe("never_fulfilled");
    expect(endedRemoval([])).toBeNull();
  });
});
