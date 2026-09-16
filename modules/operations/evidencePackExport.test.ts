// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

import { exportGovernanceEvidencePack } from "./evidencePackExport";
import type { GovernanceEvidencePack } from "@/lib/shared/types/compliance";

function makePack(overrides: Partial<GovernanceEvidencePack> = {}): GovernanceEvidencePack {
  return {
    agentId: "agent-1",
    tenantId: "tenant-a",
    generatedAt: "2026-09-16T00:00:00Z",
    identity: {
      agent: { id: "agent-1", agentName: "FinanceBot" } as never,
      contract: { id: "contract-1" } as never,
      owners: [{ id: "o1" } as never],
      identities: [],
      lifecycleEvents: [],
    },
    access: { effectiveAccess: [{ id: "g1" } as never], policyEvaluations: [], exceptions: [] },
    shouldCanDid: { agentId: "agent-1", should: [], can: [], did: [], outcomes: [{ x: 1 } as never], evaluatedAt: "x" } as never,
    risk: { findings: [{ id: "f1" } as never] },
    certifications: [{ id: "d1" } as never],
    attestations: [{ id: "a1" } as never],
    controlMappings: [{ id: "m1" } as never],
    remediation: { accessRequests: [{ id: "r1" } as never] },
    auditEvents: [{ id: "e1" } as never],
    posture: { agentId: "agent-1", tenantId: "tenant-a", status: "GOVERNED", computedAt: "x", dimensions: [{ dimension: "identity", status: "governed", reason: "ok" } as never], coveringExceptionIds: [] },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("exportGovernanceEvidencePack — OPERATIONS-P0-07", () => {
  it("produces JSON content matching the pack and audits the export", async () => {
    const pack = makePack();
    const result = await exportGovernanceEvidencePack("user-1", pack, "json");
    expect(result.contentType).toBe("application/json");
    expect(result.filename).toBe("governance-evidence-pack-agent-1.json");
    expect(JSON.parse(result.content)).toEqual(pack);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "operations.evidence_pack_exported", tenantId: "tenant-a", objectId: "agent-1", outcome: "success" }),
    );
  });

  it("produces a flattened CSV covering every section", async () => {
    const pack = makePack();
    const result = await exportGovernanceEvidencePack("user-1", pack, "csv");
    expect(result.contentType).toBe("text/csv");
    const lines = result.content.split("\n");
    expect(lines[0]).toBe("section,id,details");
    // header + one row for the agent, contract, owner, grant, shouldCanDid outcome,
    // finding, certification, attestation, control mapping, access request, audit
    // event, posture dimension, and posture status = 13 rows.
    expect(lines).toHaveLength(14);
  });

  it("the JSON and CSV export of the same pack share the same content hash", async () => {
    const pack = makePack();
    const jsonResult = await exportGovernanceEvidencePack("user-1", pack, "json");
    const csvResult = await exportGovernanceEvidencePack("user-1", pack, "csv");
    expect(jsonResult.contentHash).toBe(csvResult.contentHash);
  });
});
