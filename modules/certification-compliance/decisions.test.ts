// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetAccessGrant = vi.fn();
const mockGetEntitlement = vi.fn();
const mockCreateAccessRequest = vi.fn();
const mockRevokeAccessGrant = vi.fn();
vi.mock("@/modules/access-governance/service", () => ({
  getAccessGrant: (...a: unknown[]) => mockGetAccessGrant(...a),
  getEntitlement: (...a: unknown[]) => mockGetEntitlement(...a),
  createAccessRequest: (...a: unknown[]) => mockCreateAccessRequest(...a),
  revokeAccessGrant: (...a: unknown[]) => mockRevokeAccessGrant(...a),
}));

const mockListOwners = vi.fn();
vi.mock("@/modules/agent-identity/service", () => ({
  listOwners: (...a: unknown[]) => mockListOwners(...a),
}));

vi.mock("./snapshot", () => ({
  buildFreshSnapshot: vi.fn().mockResolvedValue({}),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

let itemRow: Record<string, unknown> | null = null;
const insertedDecisions: Record<string, unknown>[] = [];

function itemsTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: itemRow, error: null }) }),
      }),
    }),
    update: () => ({
      eq: async () => ({ error: null }),
    }),
  };
}

function decisionsTable() {
  return {
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          const data = { id: "decision-1", ...row };
          insertedDecisions.push(data);
          return { data, error: null };
        },
      }),
    }),
  };
}

function makeFrom(table: string) {
  if (table === "certification_items") return itemsTable();
  if (table === "certification_decisions") return decisionsTable();
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: (t: string) => makeFrom(t) }),
  supabaseServiceRole: () => ({ from: (t: string) => makeFrom(t) }),
}));

import { recordDecision } from "./decisions";

describe("recordDecision — 'modify' creates a real access_requests row (COMPLIANCE-P0-01.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedDecisions.length = 0;
    itemRow = {
      id: "item-1",
      tenant_id: "tenant-a",
      agent_id: "agent-1",
      access_grant_id: "grant-1",
      reviewer_id: "reviewer-1",
      status: "pending",
    };
  });

  it("resolves the grant's entitlement/application and creates a 'modify' access request", async () => {
    mockGetAccessGrant.mockResolvedValue({ id: "grant-1", entitlementId: "ent-1" });
    mockGetEntitlement.mockResolvedValue({ id: "ent-1", applicationId: "app-1" });
    mockCreateAccessRequest.mockResolvedValue({ id: "request-1" });

    await recordDecision("tenant-a", "reviewer-1", "item-1", { decision: "modify", justification: "Reduce scope to read-only" });

    expect(mockGetAccessGrant).toHaveBeenCalledWith("tenant-a", "grant-1");
    expect(mockGetEntitlement).toHaveBeenCalledWith("tenant-a", "ent-1");
    expect(mockCreateAccessRequest).toHaveBeenCalledWith(
      "tenant-a",
      "reviewer-1",
      "agent-1",
      "app-1",
      "ent-1",
      "Reduce scope to read-only",
      "modify",
    );
    expect(insertedDecisions[0]).toMatchObject({ remediation_id: "request-1" });
  });

  it("does not create a request and audits failure when the item has no access_grant_id", async () => {
    itemRow!.access_grant_id = null;

    await recordDecision("tenant-a", "reviewer-1", "item-1", { decision: "modify", justification: "Some change" });

    expect(mockGetAccessGrant).not.toHaveBeenCalled();
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "compliance.modify_without_specific_grant" }));
  });

  it("does not create a request and audits failure when the grant/entitlement can't be resolved", async () => {
    mockGetAccessGrant.mockResolvedValue(null);

    await recordDecision("tenant-a", "reviewer-1", "item-1", { decision: "modify", justification: "Some change" });

    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "compliance.modify_request_failed" }));
  });
});
