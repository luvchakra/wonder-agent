// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const mockGetAgentContract = vi.fn();
const mockGetEffectiveAccess = vi.fn();
const mockGetEffectiveAccessAsOf = vi.fn();
const mockGetDid = vi.fn();

vi.mock("@/modules/agent-identity/service", () => ({
  getAgentContract: (...args: unknown[]) => mockGetAgentContract(...args),
}));
vi.mock("@/modules/access-governance/service", () => ({
  getEffectiveAccess: (...args: unknown[]) => mockGetEffectiveAccess(...args),
  getEffectiveAccessAsOf: (...args: unknown[]) => mockGetEffectiveAccessAsOf(...args),
}));
vi.mock("./did", () => ({
  getDid: (...args: unknown[]) => mockGetDid(...args),
}));

// RUNTIME-P0-17 — the two reads compare.ts makes itself: observed tools
// (runtime_tools) and the latest gateway decision (runtime_decisions).
let toolRows: Array<{ name: string }> = [];
let latestDecision: Record<string, unknown> | null = null;
const readFilters: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      readFilters.push({ table, filters });
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: latestDecision, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: toolRows, error: null }),
      };
      return chain;
    },
  }),
}));

import { compareShouldCanDid, nowFromDecision } from "./compare";
import { SHOULD_CAN_DID_CORPUS, corpusCase } from "@/tests/runtime/should-can-did-corpus";

/** Feeds one corpus case's inputs into this file's mocked dependencies. */
function mockFromCase(c: (typeof SHOULD_CAN_DID_CORPUS)[number]) {
  mockGetAgentContract.mockResolvedValue(c.contract);
  mockGetEffectiveAccess.mockResolvedValue(c.effectiveAccess);
  mockGetDid.mockResolvedValue({ agentId: c.id, windowStart: "x", windowEnd: "y", tuples: c.didTuples });
}

describe("compareShouldCanDid — RUNTIME-P0-02.2, the central acceptance scenario", () => {
  it("reproduces the PRD's exact FinanceBot/CustomerDB scenario (QA-P0-08 'sensitive_data' corpus case)", async () => {
    mockFromCase(corpusCase("sensitive_data"));

    const result = await compareShouldCanDid("tenant-a", "financebot");

    const excessive = result.outcomes.filter((o) => o.type === "excessive_access");
    expect(excessive).toHaveLength(1);
    expect(excessive[0].evidence).toMatchObject({ grantId: "grant-snow-pii" });

    const behavioral = result.outcomes.filter((o) => o.type === "behavioral_violation");
    expect(behavioral).toHaveLength(1);
    expect(behavioral[0].evidence).toMatchObject({ eventId: "event-sensitive-1" });

    // SAP and the approved Snowflake entitlement are both covered and
    // exercised... except CAN vs DID: SAP/Financial_Reporting_READ were
    // never observed in DID, so unused_capability fires for those two.
    const unused = result.outcomes.filter((o) => o.type === "unused_capability");
    expect(unused.map((o) => o.evidence.grantId).sort()).toEqual(["grant-sap-4", "grant-snow-fin"]);

    // No insufficient_access: both approved applications have covering grants.
    expect(result.outcomes.some((o) => o.type === "insufficient_access")).toBe(false);
    // No unexpected_capability: the CustomerDB event is backed by grant-snow-pii.
    expect(result.outcomes.some((o) => o.type === "unexpected_capability")).toBe(false);
    // Not healthy, since real divergence exists.
    expect(result.outcomes.some((o) => o.type === "healthy")).toBe(false);
  });

  it("reports healthy when SHOULD, CAN and DID fully align (QA-P0-08 'allowed' corpus case)", async () => {
    mockFromCase(corpusCase("allowed"));

    const result = await compareShouldCanDid("tenant-a", "agent-2");
    expect(result.outcomes).toEqual([{ type: "healthy", evidence: {} }]);
  });

  it("is reproducible: calling twice with the same stored data yields identical outcomes", async () => {
    mockGetAgentContract.mockResolvedValue({ approvedApplications: ["SAP"], approvedData: ["financial reporting"] });
    mockGetEffectiveAccess.mockResolvedValue([{ id: "g1", application: "SAP", dataClassification: "financial" }]);
    mockGetDid.mockResolvedValue({ agentId: "a", windowStart: "x", windowEnd: "y", tuples: [] });

    const first = await compareShouldCanDid("tenant-a", "agent-3");
    const second = await compareShouldCanDid("tenant-a", "agent-3");
    expect(first.outcomes).toEqual(second.outcomes);
    expect(first.should).toEqual(second.should);
    expect(first.can).toEqual(second.can);
    expect(first.did).toEqual(second.did);
  });

  it("RUNTIME-P0-12: flags shouldUnknown when the contract has no purpose set, and never reports healthy in that state", async () => {
    mockGetAgentContract.mockResolvedValue({
      purpose: "",
      approvedApplications: ["SAP"],
      approvedData: ["financial reporting"],
    });
    mockGetEffectiveAccess.mockResolvedValue([
      { id: "g1", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial" },
    ]);
    mockGetDid.mockResolvedValue({ agentId: "agent-4", windowStart: "x", windowEnd: "y", tuples: [] });

    const result = await compareShouldCanDid("tenant-a", "agent-4");
    expect(result.shouldUnknown).toBe(true);
    expect(result.outcomes.some((o) => o.type === "healthy")).toBe(false);
  });

  it("RUNTIME-P0-12: shouldUnknown is false and healthy is reachable when the contract has a real purpose", async () => {
    mockGetAgentContract.mockResolvedValue({
      purpose: "Financial reporting automation",
      approvedApplications: ["SAP"],
      approvedData: ["financial reporting"],
    });
    mockGetEffectiveAccess.mockResolvedValue([
      { id: "g1", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial" },
    ]);
    mockGetDid.mockResolvedValue({
      agentId: "agent-5",
      windowStart: "x",
      windowEnd: "y",
      tuples: [
        {
          application: "SAP",
          resource: "GL",
          action: "read",
          dataClassification: "financial",
          firstSeenAt: "t",
          lastSeenAt: "t",
          eventCount: 1,
          sampleEventId: "event-5",
        },
      ],
    });

    const result = await compareShouldCanDid("tenant-a", "agent-5");
    expect(result.shouldUnknown).toBe(false);
    expect(result.outcomes).toEqual([{ type: "healthy", evidence: {} }]);
  });

  it("RUNTIME-P0-14: a DID tuple with no resolvable application is reported as unscored_unknown, never as a violation (QA-P0-08 'unmappable' corpus case)", async () => {
    mockFromCase(corpusCase("unmappable"));

    const result = await compareShouldCanDid("tenant-a", "agent-6");
    expect(result.outcomes).toEqual(corpusCase("unmappable").expectedOutcomes);
    expect(result.outcomes.some((o) => o.type === "behavioral_violation")).toBe(false);
    expect(result.outcomes.some((o) => o.type === "unexpected_capability")).toBe(false);
  });

  it("RUNTIME-P0-13: omitting asOf uses current effective access, never the point-in-time variant", async () => {
    mockGetAgentContract.mockResolvedValue({ purpose: "x", approvedApplications: [], approvedData: [] });
    mockGetEffectiveAccess.mockResolvedValue([]);
    mockGetDid.mockResolvedValue({ agentId: "agent-7", windowStart: "x", windowEnd: "y", tuples: [] });

    await compareShouldCanDid("tenant-a", "agent-7");

    expect(mockGetEffectiveAccess).toHaveBeenCalledWith("tenant-a", "agent-7");
    expect(mockGetEffectiveAccessAsOf).not.toHaveBeenCalled();
  });

  it("RUNTIME-P0-13: passing asOf resolves CAN as of that timestamp — an entitlement already revoked today still produces the historical excessive_access finding", async () => {
    mockGetAgentContract.mockResolvedValue({
      purpose: "Financial reporting automation",
      approvedApplications: ["SAP"],
      approvedData: ["financial reporting"],
    });
    // The grant that was in force AT THE EVENT TIME (90 days ago) — Snowflake
    // CustomerDB was still active then, even though it has since been revoked
    // and getEffectiveAccess() (current state) would no longer return it.
    mockGetEffectiveAccessAsOf.mockResolvedValue([
      { id: "grant-historical", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" },
    ]);
    mockGetDid.mockResolvedValue({ agentId: "agent-8", windowStart: "x", windowEnd: "y", tuples: [] });

    const asOf = "2026-06-14T00:00:00Z";
    const result = await compareShouldCanDid("tenant-a", "agent-8", asOf);

    expect(mockGetEffectiveAccessAsOf).toHaveBeenCalledWith("tenant-a", "agent-8", asOf);
    expect(mockGetEffectiveAccess).not.toHaveBeenCalled();
    expect(result.outcomes).toContainEqual({
      type: "excessive_access",
      evidence: { grantId: "grant-historical", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" },
    });
  });
});

describe("compareShouldCanDid — QA-P0-08, the shared runtime event corpus", () => {
  // Runs the REAL compareShouldCanDid() against every case in
  // tests/runtime/should-can-did-corpus.ts and asserts it reproduces
  // exactly that case's expectedOutcomes. This is what keeps the corpus's
  // hand-documented expectations honest — modules/risk/rules.test.ts reuses
  // the same corpus, trusting these outcomes rather than re-deriving them.
  it.each(SHOULD_CAN_DID_CORPUS)("$category ($id): matches its documented expectedOutcomes", async (c) => {
    mockFromCase(c);
    const result = await compareShouldCanDid("tenant-a", c.id);
    expect(result.outcomes).toEqual(c.expectedOutcomes);
    expect(result.outcomes.map((o) => o.type)).toEqual(c.expectedOutcomeTypes);
  });

  it("covers all six QA-P0-08 categories exactly once", () => {
    const categories = SHOULD_CAN_DID_CORPUS.map((c) => c.category).sort();
    expect(categories).toEqual(
      ["allowed", "can_only_unused", "did_only_unexpected", "sensitive_data", "unauthorized_resource", "unmappable"].sort(),
    );
  });
});

describe("compareShouldCanDid — RUNTIME-P0-17: tools and NOW", () => {
  const withTools = (allowedTools: string[]) => {
    const c = corpusCase("allowed");
    mockFromCase(c);
    mockGetAgentContract.mockResolvedValue({ ...c.contract, allowedTools });
  };

  it("SHOULD carries the contract's allowed tools", async () => {
    toolRows = [];
    withTools(["get_account"]);
    const result = await compareShouldCanDid("tenant-a", "agent");
    expect(result.should.every((s) => (s.tools ?? []).includes("get_account"))).toBe(true);
  });

  it("a used tool outside the allowed list is an unapproved_tool outcome, and not healthy", async () => {
    toolRows = [{ name: "get_account" }, { name: "Delete_Account" }];
    withTools(["get_account"]);
    const result = await compareShouldCanDid("tenant-a", "agent");
    const unapproved = result.outcomes.filter((o) => o.type === "unapproved_tool");
    expect(unapproved.map((o) => o.evidence.tool)).toEqual(["Delete_Account"]);
    expect(result.outcomes.some((o) => o.type === "healthy")).toBe(false);
    expect(result.didTools).toEqual(["Delete_Account", "get_account"]);
  });

  it("an empty allowed list does not restrict tools (same rule as the gateway)", async () => {
    toolRows = [{ name: "anything" }];
    withTools([]);
    const result = await compareShouldCanDid("tenant-a", "agent");
    expect(result.outcomes.some((o) => o.type === "unapproved_tool")).toBe(false);
  });

  it("reads tools and NOW for this tenant and agent only", async () => {
    toolRows = [];
    readFilters.length = 0;
    withTools([]);
    await compareShouldCanDid("tenant-a", "agent-x");
    for (const table of ["runtime_tools", "runtime_decisions"]) {
      const f = readFilters.find((r) => r.table === table)!;
      expect(f.filters, table).toContainEqual(["tenant_id", "tenant-a"]);
      expect(f.filters, table).toContainEqual(["agent_id", "agent-x"]);
    }
  });

  it("NOW is the latest decision; an as-of comparison has none", async () => {
    toolRows = [];
    latestDecision = {
      id: "d1",
      request_id: "r1",
      action: "READ",
      application: "Snowflake",
      tool: null,
      decision: "DENY",
      code: "DATA_PROHIBITED",
      reason: "x",
      enforced: false,
      created_at: "2026-09-25T00:00:00Z",
      steps: [
        { step: "approved_access", outcome: "DENY" },
        { step: "effective_access", outcome: "PASS" },
      ],
    };
    withTools([]);
    const now = (await compareShouldCanDid("tenant-a", "agent")).now;
    expect(now).toMatchObject({ decisionId: "d1", decision: "DENY", approved: "not_approved", effective: "within", enforced: false });

    mockGetEffectiveAccessAsOf.mockResolvedValue([]);
    expect((await compareShouldCanDid("tenant-a", "agent", "2026-09-01T00:00:00Z")).now).toBeNull();
    latestDecision = null;
  });

  it("maps decision steps to NOW's SHOULD/CAN standing", () => {
    const base = { id: "d", request_id: "r", action: "A", application: null, tool: null, decision: "ALLOW" as const, code: "c", reason: "r", enforced: false, created_at: "t" };
    expect(nowFromDecision({ ...base, steps: [{ step: "approved_access", outcome: "REQUIRE_APPROVAL" }] }).approved).toBe("requires_approval");
    expect(nowFromDecision({ ...base, steps: [{ step: "approved_access", outcome: "SKIPPED" }] }).approved).toBe("not_evaluated");
    expect(nowFromDecision({ ...base, steps: [{ step: "effective_access", outcome: "DENY" }] }).effective).toBe("outside");
    expect(nowFromDecision({ ...base, steps: null }).effective).toBe("not_evaluated");
  });
});
