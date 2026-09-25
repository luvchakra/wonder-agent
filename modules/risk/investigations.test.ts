// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: vi.fn(), supabaseServiceRole: vi.fn() }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));

import { validateCreateInvestigation } from "./investigations";

describe("validateCreateInvestigation (RISK-P0-11)", () => {
  it("keeps the known fields, de-duplicates findings and drops a smuggled tenant", () => {
    const v = validateCreateInvestigation({ title: " FinanceBot reached CustomerDB ", findingIds: ["a", "a", "b"], priority: "high", tenantId: "other" });
    expect(v).toEqual({ title: "FinanceBot reached CustomerDB", summary: null, priority: "high", findingIds: ["a", "b"], assigneeId: null });
  });

  it("needs a title and 1 to 50 findings, and a known priority", () => {
    expect(() => validateCreateInvestigation({ findingIds: ["a"] })).toThrow(/title/);
    expect(() => validateCreateInvestigation({ title: "t", findingIds: [] })).toThrow(/findingIds/);
    expect(() => validateCreateInvestigation({ title: "t", findingIds: Array.from({ length: 51 }, (_, i) => String(i)) })).toThrow(/findingIds/);
    expect(() => validateCreateInvestigation({ title: "t", findingIds: ["a"], priority: "urgent" })).toThrow(/priority/);
    expect(() => validateCreateInvestigation({ title: "x".repeat(201), findingIds: ["a"] })).toThrow(/title/);
  });
});
