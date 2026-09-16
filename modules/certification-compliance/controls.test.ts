// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockHasOpenPolicyViolation = vi.fn();
vi.mock("@/modules/access-governance/service", () => ({
  hasOpenPolicyViolation: (...a: unknown[]) => mockHasOpenPolicyViolation(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

let mappingRow: Record<string, unknown> | null = null;
let updatedStatus: string | null = null;

function mappingsTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mappingRow, error: null }) }),
      }),
    }),
    update: (patch: { status: string }) => ({
      eq: () => ({
        select: () => ({
          single: async () => {
            updatedStatus = patch.status;
            return { data: { ...(mappingRow ?? {}), ...patch }, error: null };
          },
        }),
      }),
    }),
  };
}

function evidenceTable() {
  return {
    insert: () => ({
      select: () => ({
        single: async () => ({ data: { id: "evidence-1", control_mapping_id: mappingRow?.id, evidence_type: "policy_evaluation", summary: "x", created_at: "t" }, error: null }),
      }),
    }),
  };
}

function makeFrom(table: string) {
  if (table === "control_mappings") return mappingsTable();
  if (table === "control_evidence") return evidenceTable();
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: (t: string) => makeFrom(t) }),
  supabaseServiceRole: () => ({ from: (t: string) => makeFrom(t) }),
}));

import { addControlEvidence } from "./controls";

describe("addControlEvidence — COMPLIANCE-P0-02.2's live policy-violation status check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatedStatus = null;
    mappingRow = { id: "mapping-1", tenant_id: "tenant-a", control_id: "control-1", policy_id: "policy-1", status: "compliant" };
  });

  it("computes 'non_compliant' when the mapped policy currently has an open violation", async () => {
    mockHasOpenPolicyViolation.mockResolvedValue(true);

    const result = await addControlEvidence("tenant-a", "actor-1", "mapping-1", "policy_evaluation", "Evidence summary");

    expect(mockHasOpenPolicyViolation).toHaveBeenCalledWith("tenant-a", "policy-1");
    expect(result.mapping.status).toBe("non_compliant");
    expect(updatedStatus).toBe("non_compliant");
  });

  it("computes 'compliant' when the mapped policy has no open violation", async () => {
    mockHasOpenPolicyViolation.mockResolvedValue(false);

    const result = await addControlEvidence("tenant-a", "actor-1", "mapping-1", "policy_evaluation", "Evidence summary");

    expect(result.mapping.status).toBe("compliant");
  });

  it("skips the live check entirely when the mapping has no policyId", async () => {
    mappingRow!.policy_id = null;

    const result = await addControlEvidence("tenant-a", "actor-1", "mapping-1", "policy_evaluation", "Evidence summary");

    expect(mockHasOpenPolicyViolation).not.toHaveBeenCalled();
    expect(result.mapping.status).toBe("compliant");
  });

  it("an explicit manual attestation always takes precedence over the live violation check", async () => {
    mockHasOpenPolicyViolation.mockResolvedValue(false);

    const result = await addControlEvidence("tenant-a", "actor-1", "mapping-1", "manual_attestation", "Manually reviewed", undefined, "not_applicable");

    expect(result.mapping.status).toBe("not_applicable");
  });
});
