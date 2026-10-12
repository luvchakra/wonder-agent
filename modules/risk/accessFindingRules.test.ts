import { describe, expect, it } from "vitest";
import { rogueResolution } from "./accessFindingRules";

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
