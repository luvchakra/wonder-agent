// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCompareShouldCanDid = vi.fn();
vi.mock("@/modules/runtime-assurance/service", () => ({
  compareShouldCanDid: (...a: unknown[]) => mockCompareShouldCanDid(...a),
}));

let findingRow: Record<string, unknown> | null = null;

function findingsTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: findingRow, error: null }) }),
      }),
    }),
  };
}

function evidenceTable() {
  return {
    select: () => ({
      eq: () => ({
        order: async () => ({ data: [], error: null }),
      }),
    }),
  };
}

function makeFrom(table: string) {
  if (table === "risk_findings") return findingsTable();
  if (table === "risk_evidence") return evidenceTable();
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: (t: string) => makeFrom(t) }),
  supabaseServiceRole: () => ({ from: (t: string) => makeFrom(t) }),
}));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/modules/access-governance/service", () => ({ revokeAccessGrant: vi.fn() }));
vi.mock("@/modules/operations/service", () => ({ notify: vi.fn() }));

import { getFindingAsOfDetection } from "./findings";

describe("getFindingAsOfDetection — RUNTIME-P0-13's real asOf caller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findingRow = null;
  });

  it("returns null when the finding does not exist (or belongs to another tenant, via the tenant_id filter)", async () => {
    findingRow = null;
    const result = await getFindingAsOfDetection("tenant-a", "missing-finding");
    expect(result).toBeNull();
    expect(mockCompareShouldCanDid).not.toHaveBeenCalled();
  });

  it("resolves CAN as of the finding's created_at (its 'first detected' timestamp), not today", async () => {
    findingRow = {
      id: "finding-1",
      tenant_id: "tenant-a",
      agent_id: "agent-1",
      created_at: "2026-06-01T00:00:00Z",
      status: "open",
    };
    mockCompareShouldCanDid.mockResolvedValue({
      can: [{ application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii", grantId: "grant-2" }],
      should: [],
      outcomes: [],
    });

    const result = await getFindingAsOfDetection("tenant-a", "finding-1");

    expect(mockCompareShouldCanDid).toHaveBeenCalledWith("tenant-a", "agent-1", "2026-06-01T00:00:00Z");
    expect(result?.comparisonAsOfDetection.can).toHaveLength(1);
    expect(result?.finding.id).toBe("finding-1");
  });
});
