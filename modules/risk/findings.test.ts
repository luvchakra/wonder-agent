// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

const revokeAccessGrant = vi.fn();
vi.mock("@/modules/access-governance/service", () => ({
  revokeAccessGrant: (...a: unknown[]) => revokeAccessGrant(...a),
}));

let findingRow: Record<string, unknown> | null = { id: "finding-1", tenant_id: "tenant-a", status: "open" };
let evidenceRows: Record<string, unknown>[] = [];
let updatedRow: Record<string, unknown> | null = null;

function findingsTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: findingRow, error: null }) }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              updatedRow = { ...(findingRow ?? {}), ...patch };
              return { data: updatedRow, error: null };
            },
          }),
        }),
      }),
    }),
  };
}

function evidenceTable() {
  return {
    select: () => ({
      eq: async () => ({ data: evidenceRows, error: null }),
    }),
  };
}

function makeFrom(table: string) {
  if (table === "risk_findings") return findingsTable();
  if (table === "risk_evidence") return evidenceTable();
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({ from: (t: string) => makeFrom(t) }),
  supabaseServer: async () => ({ from: (t: string) => makeFrom(t) }),
}));

import { remediateFinding } from "./findings";
import { ApiError } from "@/lib/shared/types/foundation";

beforeEach(() => {
  vi.clearAllMocks();
  findingRow = { id: "finding-1", tenant_id: "tenant-a", status: "open" };
  evidenceRows = [];
  updatedRow = null;
});

describe("remediateFinding — RISK-P0-03.2", () => {
  it("throws 404 when the finding doesn't exist in this tenant", async () => {
    findingRow = null;
    await expect(remediateFinding("tenant-a", "user-1", "finding-1")).rejects.toMatchObject({ status: 404 });
  });

  it("is honestly not wired when the finding has no access_grant evidence", async () => {
    evidenceRows = [{ evidence_type: "ownership_fact", reference_id: "owner-1" }];
    const result = await remediateFinding("tenant-a", "user-1", "finding-1");
    expect(result.wired).toBe(false);
    expect(result.revokedGrantIds).toEqual([]);
    expect(revokeAccessGrant).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }));
    expect(updatedRow).toBeNull();
  });

  it("revokes every access_grant the finding's evidence names and marks it remediation_in_progress", async () => {
    evidenceRows = [
      { evidence_type: "access_grant", reference_id: "grant-1" },
      { evidence_type: "access_grant", reference_id: "grant-2" },
      { evidence_type: "policy_evaluation", reference_id: "eval-1" },
    ];
    revokeAccessGrant.mockResolvedValue(undefined);

    const result = await remediateFinding("tenant-a", "user-1", "finding-1");

    expect(revokeAccessGrant).toHaveBeenCalledWith("tenant-a", "user-1", "grant-1");
    expect(revokeAccessGrant).toHaveBeenCalledWith("tenant-a", "user-1", "grant-2");
    expect(revokeAccessGrant).toHaveBeenCalledTimes(2);
    expect(result.wired).toBe(true);
    expect(result.revokedGrantIds.sort()).toEqual(["grant-1", "grant-2"]);
    expect(result.finding.status).toBe("remediation_in_progress");
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", metadata: { revokedGrantIds: ["grant-1", "grant-2"] } }));
  });

  it("still reports wired:true if at least one grant revokes, even when another fails (already removed)", async () => {
    evidenceRows = [
      { evidence_type: "access_grant", reference_id: "grant-1" },
      { evidence_type: "access_grant", reference_id: "grant-2" },
    ];
    revokeAccessGrant.mockImplementation(async (_t: string, _a: string, grantId: string) => {
      if (grantId === "grant-2") throw new ApiError(404, "GRANT_NOT_FOUND", "already gone");
    });

    const result = await remediateFinding("tenant-a", "user-1", "finding-1");
    expect(result.wired).toBe(true);
    expect(result.revokedGrantIds).toEqual(["grant-1"]);
  });

  it("is not wired when every named grant fails to revoke", async () => {
    evidenceRows = [{ evidence_type: "access_grant", reference_id: "grant-1" }];
    revokeAccessGrant.mockRejectedValue(new ApiError(404, "GRANT_NOT_FOUND", "gone"));

    const result = await remediateFinding("tenant-a", "user-1", "finding-1");
    expect(result.wired).toBe(false);
    expect(result.revokedGrantIds).toEqual([]);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failure", metadata: { reason: expect.stringContaining("none could be revoked") } }),
    );
  });
});
