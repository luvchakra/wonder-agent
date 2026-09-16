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
    risk: { findings: [{ id: "f1", severity: "high", title: "Unauthorized CustomerDB access", status: "open" } as never] },
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
    expect(JSON.parse(result.content as string)).toEqual(pack);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "operations.evidence_pack_exported", tenantId: "tenant-a", objectId: "agent-1", outcome: "success" }),
    );
  });

  it("produces a flattened CSV covering every section", async () => {
    const pack = makePack();
    const result = await exportGovernanceEvidencePack("user-1", pack, "csv");
    expect(result.contentType).toBe("text/csv");
    const lines = (result.content as string).split("\n");
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

  it("produces a real PDF document (starts with the %PDF signature) and shares the same content hash as JSON/CSV", async () => {
    const pack = makePack();
    const result = await exportGovernanceEvidencePack("user-1", pack, "pdf");
    expect(result.contentType).toBe("application/pdf");
    expect(result.filename).toBe("governance-evidence-pack-agent-1.pdf");

    const bytes = result.content as Uint8Array;
    const signature = Buffer.from(bytes.slice(0, 5)).toString("ascii");
    expect(signature).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(0);

    const jsonResult = await exportGovernanceEvidencePack("user-1", pack, "json");
    expect(result.contentHash).toBe(jsonResult.contentHash);
  });

  it("PDF export never throws on a pack with no records in any section", async () => {
    const pack = makePack({
      identity: { agent: { id: "agent-1", agentName: "EmptyBot" } as never, contract: null, owners: [], identities: [], lifecycleEvents: [] },
      access: { effectiveAccess: [], policyEvaluations: [], exceptions: [] },
      shouldCanDid: { agentId: "agent-1", should: [], can: [], did: [], outcomes: [], evaluatedAt: "x" } as never,
      risk: { findings: [] },
      certifications: [],
      attestations: [],
      controlMappings: [],
      remediation: { accessRequests: [] },
    });
    await expect(exportGovernanceEvidencePack("user-1", pack, "pdf")).resolves.toMatchObject({ contentType: "application/pdf" });
  });
});
