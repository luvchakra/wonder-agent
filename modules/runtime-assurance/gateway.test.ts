// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let decisions: Row[] = [];
let audits: Row[] = [];
let forceConflict = false;
let events: Row[] = [];

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let pending: Row | null = null;
  const match = () => decisions.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null;
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
    maybeSingle: async () => ({ data: table === "runtime_decisions" ? match() : null, error: null }),
    insert: (row: Row) => {
      if (table === "runtime_events") {
        events.push(row);
        return Promise.resolve({ error: null });
      }
      pending = row;
      return chain;
    },
    single: async () => {
      if (forceConflict) {
        forceConflict = false;
        // Another delivery won the race and its row is now present.
        decisions.push({ id: "winner", created_at: "2026-09-25T00:00:00Z", ...pending });
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      const row = { id: `d${decisions.length + 1}`, created_at: "2026-09-25T00:00:00Z", ...pending };
      decisions.push(row);
      return { data: row, error: null };
    },
  };
  return chain;
}

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: query }), supabaseServer: async () => ({ from: query }) }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: async (e: Row) => void audits.push(e) }));
const evaluate = vi.fn();
vi.mock("@/modules/access-governance/service", () => ({ evaluateRuntimeRequest: (...a: unknown[]) => evaluate(...a) }));

import { authorizeRuntimeRequest, decisionEventType, parseGatewayRequest } from "./gateway";

const principal = { tenantId: "tenant-a", agentId: "agent-a", keyId: "key-a" };

beforeEach(() => {
  decisions = [];
  audits = [];
  forceConflict = false;
  events = [];
  evaluate.mockReset();
  evaluate.mockResolvedValue({
    decision: "DENY",
    code: "DATA_PROHIBITED",
    reason: "pii data is prohibited by the contract.",
    steps: [{ step: "approved_access", outcome: "DENY", code: "DATA_PROHIBITED", reason: "x" }],
  });
});

describe("parseGatewayRequest", () => {
  it("keeps known fields and drops any smuggled tenant or agent", () => {
    const req = parseGatewayRequest({
      requestId: " r-1 ",
      action: "READ",
      application: "Snowflake",
      tenantId: "tenant-b",
      agentId: "agent-b",
      context: { environment: "production" },
    });
    expect(req.requestId).toBe("r-1");
    expect(req).not.toHaveProperty("tenantId");
    expect(req).not.toHaveProperty("agentId");
    expect(req.context?.environment).toBe("production");
  });

  it("rejects missing, oversized or mistyped fields", () => {
    expect(() => parseGatewayRequest({ action: "READ" })).toThrow(/requestId/);
    expect(() => parseGatewayRequest({ requestId: "r" })).toThrow(/action/);
    expect(() => parseGatewayRequest({ requestId: "r", action: "x".repeat(201) })).toThrow(/at most 200/);
    expect(() => parseGatewayRequest({ requestId: "r", action: 7 })).toThrow(/must be a string/);
    expect(() => parseGatewayRequest({ requestId: "r", action: "READ", identityId: "not-a-uuid" })).toThrow(/UUID/);
    expect(() => parseGatewayRequest([])).toThrow(/JSON object/);
  });
});

describe("authorizeRuntimeRequest", () => {
  it("records the computed decision but tells the caller to proceed in OBSERVE_ONLY mode", async () => {
    const d = await authorizeRuntimeRequest(principal, parseGatewayRequest({ requestId: "r-1", action: "READ", application: "Snowflake" }));
    expect(d.mode).toBe("OBSERVE_ONLY");
    expect(d.enforced).toBe(false);
    expect(d.decision).toBe("DENY");
    expect(d.effectiveDecision).toBe("ALLOW");
    expect(d.replayed).toBe(false);
    expect(decisions[0]).toMatchObject({ tenant_id: "tenant-a", agent_id: "agent-a", api_key_id: "key-a", decision: "DENY", enforced: false });
    expect(evaluate).toHaveBeenCalledWith({ tenantId: "tenant-a", agentId: "agent-a", keyId: "key-a" }, expect.anything(), { tenantActive: true });
  });

  it("audits each decision once, with no secret material", async () => {
    await authorizeRuntimeRequest(principal, parseGatewayRequest({ requestId: "r-2", action: "READ" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "runtime.decision", tenantId: "tenant-a", objectType: "runtime_decision" });
    expect(JSON.stringify(audits[0])).not.toMatch(/wa_ak_/);
  });

  it("is idempotent: a repeated request id returns the stored decision, never a second record", async () => {
    const first = await authorizeRuntimeRequest(principal, parseGatewayRequest({ requestId: "r-3", action: "READ" }));
    evaluate.mockResolvedValue({ decision: "ALLOW", code: "ALLOWED", reason: "ok", steps: [] });
    const again = await authorizeRuntimeRequest(principal, parseGatewayRequest({ requestId: "r-3", action: "READ" }));
    expect(again.decisionId).toBe(first.decisionId);
    expect(again.decision).toBe("DENY");
    expect(again.replayed).toBe(true);
    // Evaluated alongside the lookup, but the stored answer is what returns.
    expect(decisions).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(audits).toHaveLength(1);
  });

  it("a concurrent duplicate that loses the insert race returns the winner's decision and writes no second audit", async () => {
    forceConflict = true;
    const d = await authorizeRuntimeRequest(principal, parseGatewayRequest({ requestId: "r-4", action: "READ" }));
    expect(d.decisionId).toBe("winner");
    expect(d.replayed).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(audits).toHaveLength(0);
  });

  it("the same request id from another agent is a separate request", async () => {
    await authorizeRuntimeRequest(principal, parseGatewayRequest({ requestId: "r-5", action: "READ" }));
    const other = await authorizeRuntimeRequest({ ...principal, agentId: "agent-b" }, parseGatewayRequest({ requestId: "r-5", action: "READ" }));
    expect(other.replayed).toBe(false);
    expect(decisions).toHaveLength(2);
  });
});

describe("decision events (RUNTIME-P0-16)", () => {
  it("records each decision once on the timeline, as a decision type DID ignores, linked to its row", async () => {
    const d = await authorizeRuntimeRequest(
      principal,
      parseGatewayRequest({ requestId: "r-ev", action: "READ", tool: "query_db", context: { sessionId: "s-1" } }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenant_id: "tenant-a",
      agent_id: "agent-a",
      source: "gateway",
      event_type: "TOOL_DENIED",
      decision_id: d.decisionId,
      session_id: "s-1",
      dedupe_key: `gateway:${d.decisionId}`,
    });
    // A replay records nothing new.
    await authorizeRuntimeRequest(principal, parseGatewayRequest({ requestId: "r-ev", action: "READ", tool: "query_db" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toHaveLength(1);
  });

  it("maps decisions to event types", () => {
    expect(decisionEventType("DENY", "t")).toBe("TOOL_DENIED");
    expect(decisionEventType("REQUIRE_APPROVAL", "t")).toBe("TOOL_APPROVAL_REQUIRED");
    expect(decisionEventType("ALLOW", "t")).toBe("TOOL_ALLOWED");
    expect(decisionEventType("ALLOW_WITH_RESTRICTIONS", "t")).toBe("TOOL_ALLOWED");
    expect(decisionEventType("DENY", undefined)).toBe("POLICY_DECISION");
  });
});
