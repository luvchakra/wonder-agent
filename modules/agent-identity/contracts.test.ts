// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: async () => ({}), supabaseServiceRole: () => ({}) }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));

import { nextReviewAt } from "./contracts";

describe("nextReviewAt — IDENTITY-P0-13", () => {
  const from = new Date("2026-01-15T10:00:00.000Z");

  it("adds the certification frequency to the publication date", () => {
    expect(nextReviewAt(from, "monthly", null)).toBe("2026-02-15T10:00:00.000Z");
    expect(nextReviewAt(from, "quarterly", null)).toBe("2026-04-15T10:00:00.000Z");
    expect(nextReviewAt(from, "semiannual", null)).toBe("2026-07-15T10:00:00.000Z");
    expect(nextReviewAt(from, "annual", null)).toBe("2027-01-15T10:00:00.000Z");
  });

  it("is never later than the contract's own expiry", () => {
    expect(nextReviewAt(from, "annual", "2026-03-01T00:00:00.000Z")).toBe("2026-03-01T00:00:00.000Z");
    expect(nextReviewAt(from, "monthly", "2027-01-01T00:00:00.000Z")).toBe("2026-02-15T10:00:00.000Z");
  });
});
