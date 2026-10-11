import { describe, expect, it } from "vitest";
import { lineState } from "./labels";

const NOW = new Date("2026-10-11T12:00:00Z");
const req = (over: Partial<{ status: string; requestType: string; requestedExpiry: string | null }> = {}) => ({ status: "approved", requestType: "grant", requestedExpiry: null, ...over });

describe("lineState (EXPERIENCE-P0-29)", () => {
  it("shows the status until approved, then how far the line has really come", () => {
    expect(lineState(req({ status: "pending" }), null, NOW).label).toBe("Waiting for approval");
    expect(lineState(req({ status: "rejected" }), null, NOW).label).toBe("Rejected");
    expect(lineState(req(), "pending_fulfilment", NOW).label).toBe("Approved · waiting for fulfilment");
    expect(lineState(req(), "fulfilled_unverified", NOW).label).toBe("Fulfilled · not yet verified");
    expect(lineState(req(), "verified", NOW)).toMatchObject({ label: "Verified at the source", tone: "success" });
    expect(lineState(req(), "failed", NOW).tone).toBe("danger");
    expect(lineState(req({ requestType: "remove" }), "verified", NOW).label).toBe("Removal verified at the source");
  });
  it("never claims more than the server knows: without progress an approved line is just approved", () => {
    expect(lineState(req(), undefined, NOW).label).toBe("Approved");
    expect(lineState(req(), "untracked", NOW).label).toBe("Approved");
  });
  it("time-bound access past its end date has ended, whatever its progress", () => {
    expect(lineState(req({ requestedExpiry: "2026-10-10T00:00:00Z" }), "verified", NOW).label).toBe("Ended");
    expect(lineState(req({ requestedExpiry: "2026-10-20T00:00:00Z" }), "verified", NOW).label).toBe("Verified at the source");
  });
});
