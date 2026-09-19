import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Agent, AgentLifecycleState } from "@/lib/shared/types/agent-identity";

const mockNotify = vi.fn();
vi.mock("@/modules/operations/service", () => ({
  notify: (event: unknown) => mockNotify(event),
}));

const mockListOwners = vi.fn();
vi.mock("./owners", () => ({
  listOwners: (...a: unknown[]) => mockListOwners(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

let agentRow: Record<string, unknown> | null = null;
const insertedEvents: Record<string, unknown>[] = [];

function agentsTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: agentRow, error: null }) }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: () => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              Object.assign(agentRow!, patch);
              return { data: agentRow, error: null };
            },
          }),
        }),
      }),
    }),
  };
}

function eventsTable() {
  return {
    insert: async (row: Record<string, unknown>) => {
      insertedEvents.push(row);
      return { error: null };
    },
  };
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({
    from: (table: string) => (table === "agents" ? agentsTable() : eventsTable()),
  }),
}));

import { isStructurallyAllowedTransition, maybeMarkCertificationDue } from "./lifecycle";

/** Minimal, fully-typed Agent fixture for maybeMarkCertificationDue's tests below. */
function makeAgent(over: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    tenantId: "tenant-a",
    agentName: "FinanceBot",
    displayName: null,
    description: null,
    purpose: null,
    agentType: "workflow",
    agentFramework: null,
    modelProvider: null,
    modelName: null,
    modelVersion: null,
    runtime: null,
    environment: "production",
    criticality: "medium",
    dataClassification: null,
    status: "active",
    lifecycleState: "ACTIVE",
    sourceSystem: null,
    sourceObjectId: null,
    enterpriseIdentityId: null,
    serviceAccountId: null,
    riskScore: null,
    postureScore: null,
    createdAt: "t",
    activatedAt: null,
    lastSeenAt: null,
    nextReviewAt: null,
    retirementDate: null,
    ...over,
  };
}

const ALL_STATES: AgentLifecycleState[] = [
  "DISCOVERED",
  "REGISTERED",
  "ASSESSED",
  "APPROVED",
  "PROVISIONED",
  "ACTIVE",
  "CERTIFICATION_DUE",
  "RESTRICTED",
  "SUSPENDED",
  "RETIRED",
];

describe("isStructurallyAllowedTransition — IDENTITY-P0-02.1 transition table", () => {
  it("allows every normal forward transition in the backlog's table", () => {
    expect(isStructurallyAllowedTransition("DISCOVERED", "REGISTERED")).toBe(true);
    expect(isStructurallyAllowedTransition("REGISTERED", "APPROVED")).toBe(true);
    expect(isStructurallyAllowedTransition("APPROVED", "PROVISIONED")).toBe(true);
    expect(isStructurallyAllowedTransition("PROVISIONED", "ACTIVE")).toBe(true);
    expect(isStructurallyAllowedTransition("ACTIVE", "CERTIFICATION_DUE")).toBe(true);
    expect(isStructurallyAllowedTransition("ACTIVE", "RESTRICTED")).toBe(true);
    expect(isStructurallyAllowedTransition("CERTIFICATION_DUE", "ACTIVE")).toBe(true);
    expect(isStructurallyAllowedTransition("RESTRICTED", "SUSPENDED")).toBe(true);
    expect(isStructurallyAllowedTransition("SUSPENDED", "RETIRED")).toBe(true);
  });

  it("IDENTITY-P0-06: allows the staged restoration path (SUSPENDED -> RESTRICTED -> ACTIVE)", () => {
    expect(isStructurallyAllowedTransition("SUSPENDED", "RESTRICTED")).toBe(true);
    expect(isStructurallyAllowedTransition("RESTRICTED", "ACTIVE")).toBe(true);
    // Still no direct shortcut from SUSPENDED straight back to ACTIVE.
    expect(isStructurallyAllowedTransition("SUSPENDED", "ACTIVE")).toBe(false);
  });

  it("allows the 'any state -> SUSPENDED' emergency wildcard, except from RETIRED", () => {
    for (const from of ALL_STATES) {
      const expected = from !== "RETIRED";
      expect(isStructurallyAllowedTransition(from, "SUSPENDED")).toBe(expected);
    }
  });

  it("rejects transitions never listed in the table", () => {
    expect(isStructurallyAllowedTransition("DISCOVERED", "ACTIVE")).toBe(false);
    expect(isStructurallyAllowedTransition("ACTIVE", "DISCOVERED")).toBe(false);
    expect(isStructurallyAllowedTransition("RETIRED", "ACTIVE")).toBe(false);
    expect(isStructurallyAllowedTransition("APPROVED", "RESTRICTED")).toBe(false);
  });

  it("RETIRED is terminal: no transition out of it is allowed", () => {
    for (const to of ALL_STATES) {
      if (to === "RETIRED") continue;
      expect(isStructurallyAllowedTransition("RETIRED", to)).toBe(false);
    }
  });

  it("every state can reach RETIRED only via SUSPENDED -> RETIRED", () => {
    for (const from of ALL_STATES) {
      const allowed = isStructurallyAllowedTransition(from, "RETIRED");
      expect(allowed).toBe(from === "SUSPENDED");
    }
  });
});

/**
 * OPERATIONS-P0-02.2's `certification_due` trigger (2026-09-19) — see
 * modules/agent-identity/owners.test.ts and
 * modules/access-governance/policies.test.ts for the matching coverage
 * of the other two previously-unwired trigger types.
 */
describe("maybeMarkCertificationDue — OPERATIONS-P0-02.2's certification_due trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedEvents.length = 0;
    agentRow = {
      id: "agent-1",
      tenant_id: "tenant-a",
      agent_name: "FinanceBot",
      agent_type: "workflow",
      status: "active",
      lifecycle_state: "ACTIVE",
      next_review_at: "2020-01-01T00:00:00Z", // in the past
      created_at: "t",
    };
    mockListOwners.mockResolvedValue([]);
  });

  it("transitions to CERTIFICATION_DUE and notifies the business owner when one exists", async () => {
    mockListOwners.mockResolvedValue([{ ownerType: "business_owner", userId: "owner-1" }]);
    const agent = makeAgent({ lifecycleState: "ACTIVE", nextReviewAt: "2020-01-01T00:00:00Z" });

    const result = await maybeMarkCertificationDue("tenant-a", agent);

    expect(result.lifecycleState).toBe("CERTIFICATION_DUE");
    expect(insertedEvents).toHaveLength(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        userId: "owner-1",
        type: "certification_due",
        referenceType: "agent",
        referenceId: "agent-1",
      }),
    );
  });

  it("broadcasts (userId: null) when the agent has no business owner", async () => {
    mockListOwners.mockResolvedValue([]);
    const agent = makeAgent({ lifecycleState: "ACTIVE", nextReviewAt: "2020-01-01T00:00:00Z" });

    await maybeMarkCertificationDue("tenant-a", agent);

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: null, type: "certification_due" }));
  });

  it("does nothing when the agent is not ACTIVE", async () => {
    const agent = makeAgent({ lifecycleState: "SUSPENDED", nextReviewAt: "2020-01-01T00:00:00Z" });

    const result = await maybeMarkCertificationDue("tenant-a", agent);

    expect(result).toBe(agent);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does nothing when next_review_at hasn't elapsed yet", async () => {
    const agent = makeAgent({ lifecycleState: "ACTIVE", nextReviewAt: "2099-01-01T00:00:00Z" });

    const result = await maybeMarkCertificationDue("tenant-a", agent);

    expect(result).toBe(agent);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does nothing when the agent has no next_review_at set at all", async () => {
    const agent = makeAgent({ lifecycleState: "ACTIVE", nextReviewAt: null });

    const result = await maybeMarkCertificationDue("tenant-a", agent);

    expect(result).toBe(agent);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
