import { describe, expect, it } from "vitest";
import { decidesOwnAccess, exceptionEnded, rogueResolution, rogueTrend, validateRogueDecision } from "./accessFindingRules";

const live = { revokedAt: null, missingFromSourceAt: null, requestId: null, packageItemId: null };

describe("rogueResolution (WID-H04)", () => {
  it("is fixed when the access is gone: revoked, missing at the source, or no grant at all", () => {
    expect(rogueResolution({ ...live, revokedAt: "2026-10-12T00:00:00Z", requestId: "r1" }).type).toBe("verified_fixed");
    expect(rogueResolution({ ...live, missingFromSourceAt: "2026-10-12T00:00:00Z" }).type).toBe("verified_fixed");
    expect(rogueResolution(null)).toMatchObject({ type: "verified_fixed", requestId: null });
  });
  it("is approved afterwards when the access is still there, naming the request that approved it", () => {
    expect(rogueResolution({ ...live, requestId: "r1" })).toMatchObject({ type: "approved_afterwards", requestId: "r1" });
    expect(rogueResolution({ ...live, packageItemId: "p1" }).reason).toMatch(/access package/);
    expect(rogueResolution(live).type).toBe("approved_afterwards");
  });
});

describe("rogue-access decisions (WID-H04)", () => {
  const now = new Date("2026-10-12T10:00:00Z");
  it("an accepted exception needs a reason and an end within 90 days", () => {
    expect(validateRogueDecision({ outcome: "exception", reason: "Quarter-end close", until: "2026-11-01" }, now)).toEqual({ outcome: "exception", reason: "Quarter-end close", until: "2026-11-01T23:59:59.000Z" });
    expect(validateRogueDecision({ outcome: "exception", reason: "x", until: "2027-02-01" }, now)).toEqual({ error: "until: at most 90 days from today" });
    expect(validateRogueDecision({ outcome: "exception", reason: "x", until: "2026-10-01" }, now)).toEqual({ error: "until: a date in the future" });
    expect(validateRogueDecision({ outcome: "exception", reason: "x" }, now)).toEqual({ error: "until: the date the exception ends" });
    expect(validateRogueDecision({ outcome: "exception", reason: "  ", until: "2026-11-01" }, now)).toEqual({ error: "reason: say why" });
  });
  it("a false positive needs a reason only; anything else is refused", () => {
    expect(validateRogueDecision({ outcome: "false_positive", reason: "Granted by the HR feed" }, now)).toEqual({ outcome: "false_positive", reason: "Granted by the HR feed", until: null });
    expect(validateRogueDecision({ outcome: "accepted_risk", reason: "x" }, now)).toEqual({ error: "outcome: exception or false_positive" });
  });
  it("the account's owner never decides on their own access", () => {
    expect(decidesOwnAccess("id-1", "id-1")).toBe(true);
    expect(decidesOwnAccess("id-2", "id-1")).toBe(false);
    expect(decidesOwnAccess(null, "id-1")).toBe(false);
    expect(decidesOwnAccess("id-1", null)).toBe(false);
  });
  it("an exception ends at its date", () => {
    expect(exceptionEnded("2026-10-12T09:59:59Z", now)).toBe(true);
    expect(exceptionEnded("2026-10-12T10:00:01Z", now)).toBe(false);
    expect(exceptionEnded(null, now)).toBe(false);
  });
});

describe("rogueTrend", () => {
  const now = new Date("2026-10-14T10:00:00Z"); // a Wednesday; its week starts Monday 10-12
  it("counts found, resolved and open per week, oldest first, ending with this week", () => {
    const weeks = rogueTrend(
      [
        { createdAt: "2026-10-01T00:00:00Z", resolvedAt: "2026-10-13T00:00:00Z" },
        { createdAt: "2026-10-06T09:00:00Z", resolvedAt: null },
        { createdAt: "2026-10-12T00:00:00Z", resolvedAt: null },
      ],
      now,
      3,
    );
    expect(weeks.map((w) => w.label)).toEqual(["09-28", "10-05", "10-12"]);
    expect(weeks[0]).toEqual({ label: "09-28", found: 1, resolved: 0, open: 1 });
    expect(weeks[1]).toEqual({ label: "10-05", found: 1, resolved: 0, open: 2 });
    expect(weeks[2]).toEqual({ label: "10-12", found: 1, resolved: 1, open: 2 });
  });

  it("an empty history is zero every week", () => {
    expect(rogueTrend([], now, 2)).toEqual([
      { label: "10-05", found: 0, resolved: 0, open: 0 },
      { label: "10-12", found: 0, resolved: 0, open: 0 },
    ]);
  });
});
