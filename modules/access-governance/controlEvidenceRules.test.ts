import { describe, expect, it } from "vitest";
import { removalOutcome, slaOutcome } from "./controlEvidenceRules";

describe("control evidence (COMPLIANCE-P0-14 part 2)", () => {
  it("a removal is verified only when every grant is gone at the source", () => {
    expect(removalOutcome([{ revokedAt: "2026-10-14T00:00:00Z", removalStatus: "removed_unverified" }], [{ status: "verified" }])).toBe("verified");
    expect(removalOutcome([{ revokedAt: null, removalStatus: "removed_unverified" }], [{ status: "completed" }])).toBe("removed_unverified");
    expect(removalOutcome([{ revokedAt: null, removalStatus: "pending_removal" }], [{ status: "open" }])).toBe("pending");
    expect(removalOutcome([{ revokedAt: null, removalStatus: "pending_removal" }], [{ status: "failed" }])).toBe("failed");
    expect(removalOutcome([], [])).toBe("pending");
  });
  it("a removal task is on time, late, overdue, open or failed", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const due = "2026-10-14T00:00:00Z";
    expect(slaOutcome({ status: "completed", dueAt: due, doneAt: "2026-10-13T20:00:00Z" }, now)).toBe("on_time");
    expect(slaOutcome({ status: "verified", dueAt: due, doneAt: "2026-10-14T06:00:00Z" }, now)).toBe("late");
    expect(slaOutcome({ status: "open", dueAt: due, doneAt: null }, now)).toBe("overdue");
    expect(slaOutcome({ status: "claimed", dueAt: "2026-10-15T00:00:00Z", doneAt: null }, now)).toBe("open");
    expect(slaOutcome({ status: "failed", dueAt: due, doneAt: null }, now)).toBe("failed");
  });
});
