// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

let agentRow: { id: string } | null = { id: "agent-1" };
let insertedRow: Record<string, unknown> | null = null;
let listRows: Record<string, unknown>[] = [];
const insertFn = vi.fn((payload: Record<string, unknown>) => {
  insertedRow = { id: "attestation-1", created_at: "2026-09-16T00:00:00Z", decided_at: "2026-09-16T00:00:00Z", valid_from: "2026-09-16T00:00:00Z", ...payload };
  return {
    select: () => ({
      single: async () => ({ data: insertedRow, error: null }),
    }),
  };
});

function agentsTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: agentRow, error: null }),
        }),
      }),
    }),
  };
}

function attestationsTable() {
  return {
    insert: insertFn,
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: async () => ({ data: listRows, error: null }),
        }),
      }),
    }),
  };
}

function makeFrom(table: string) {
  if (table === "agents") return agentsTable();
  if (table === "governance_attestations") return attestationsTable();
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({ from: (t: string) => makeFrom(t) }),
  supabaseServer: async () => ({ from: (t: string) => makeFrom(t) }),
}));

import { recordAttestation, listAttestationsForAgent, getLatestAttestation } from "./attestations";
import { ApiError } from "@/lib/shared/types/foundation";

beforeEach(() => {
  vi.clearAllMocks();
  agentRow = { id: "agent-1" };
  insertedRow = null;
  listRows = [];
});

describe("recordAttestation — COMPLIANCE-P0-08", () => {
  it("rejects an empty policyRequirement", async () => {
    await expect(
      recordAttestation("tenant-a", "user-1", "agent-1", { policyRequirement: "  ", checklist: [], decision: "attested" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("404s when the agent doesn't belong to the tenant", async () => {
    agentRow = null;
    await expect(
      recordAttestation("tenant-a", "user-1", "agent-1", { policyRequirement: "Financial data handling", checklist: [], decision: "attested" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("inserts the attestation row and writes an audit event", async () => {
    const result = await recordAttestation("tenant-a", "user-1", "agent-1", {
      policyRequirement: "Financial data handling",
      checklist: [{ item: "Reviewed approved data scope", checked: true }],
      decision: "attested",
      comments: "Looks good",
      evidenceReferences: [{ type: "policy_evaluation", referenceId: "eval-1", summary: "pass" }],
    });

    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-a",
        agent_id: "agent-1",
        policy_requirement: "Financial data handling",
        approver_id: "user-1",
        decision: "attested",
        comments: "Looks good",
      }),
    );
    expect(result.decision).toBe("attested");
    expect(result.policyRequirement).toBe("Financial data handling");
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "compliance.attestation_recorded", tenantId: "tenant-a", actorId: "user-1", outcome: "success" }),
    );
  });
});

describe("listAttestationsForAgent / getLatestAttestation — COMPLIANCE-P0-08", () => {
  it("maps rows to GovernanceAttestation shape", async () => {
    listRows = [
      {
        id: "a1",
        tenant_id: "tenant-a",
        agent_id: "agent-1",
        policy_requirement: "Financial data handling",
        checklist: [],
        approver_id: "user-1",
        decision: "attested",
        comments: null,
        evidence_references: [],
        valid_from: "2026-09-01T00:00:00Z",
        valid_until: null,
        decided_at: "2026-09-01T00:00:00Z",
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    const result = await listAttestationsForAgent("tenant-a", "agent-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a1");
    expect(result[0].decision).toBe("attested");
  });

  it("getLatestAttestation filters by policyRequirement and returns the first match", async () => {
    listRows = [
      {
        id: "a2",
        tenant_id: "tenant-a",
        agent_id: "agent-1",
        policy_requirement: "Data retention",
        checklist: [],
        approver_id: "user-1",
        decision: "attested",
        comments: null,
        evidence_references: [],
        valid_from: "2026-09-01T00:00:00Z",
        valid_until: null,
        decided_at: "2026-09-05T00:00:00Z",
        created_at: "2026-09-05T00:00:00Z",
      },
      {
        id: "a1",
        tenant_id: "tenant-a",
        agent_id: "agent-1",
        policy_requirement: "Financial data handling",
        checklist: [],
        approver_id: "user-1",
        decision: "attested",
        comments: null,
        evidence_references: [],
        valid_from: "2026-09-01T00:00:00Z",
        valid_until: null,
        decided_at: "2026-09-01T00:00:00Z",
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    const result = await getLatestAttestation("tenant-a", "agent-1", "Financial data handling");
    expect(result?.id).toBe("a1");
  });

  it("getLatestAttestation returns null when there is no matching attestation", async () => {
    listRows = [];
    const result = await getLatestAttestation("tenant-a", "agent-1");
    expect(result).toBeNull();
  });
});
