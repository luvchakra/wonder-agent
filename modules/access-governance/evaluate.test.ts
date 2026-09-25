// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

let evaluationRows: { agent_id: string; result: string }[] = [];

function makeFrom(table: string) {
  if (table === "policy_evaluations") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({ data: evaluationRows, error: null }),
          }),
        }),
      }),
    };
  }
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: (t: string) => makeFrom(t) }),
  supabaseServiceRole: () => ({ from: (t: string) => makeFrom(t) }),
}));

import { hasOpenPolicyViolation, isExceptionInForce } from "./evaluate";

describe("hasOpenPolicyViolation — COMPLIANCE-P0-02.2's published dependency", () => {
  beforeEach(() => {
    evaluationRows = [];
  });

  it("returns false when no agent has ever been evaluated against this policy", async () => {
    evaluationRows = [];
    expect(await hasOpenPolicyViolation("tenant-a", "policy-1")).toBe(false);
  });

  it("returns true when an agent's most recent evaluation is a violation", async () => {
    // Rows are returned newest-first (the real query orders evaluated_at desc).
    evaluationRows = [{ agent_id: "agent-1", result: "violation" }];
    expect(await hasOpenPolicyViolation("tenant-a", "policy-1")).toBe(true);
  });

  it("ignores a stale violation that has since been superseded by a passing re-evaluation", async () => {
    // Newest row for agent-1 is 'pass' — the older 'violation' row must not count.
    evaluationRows = [
      { agent_id: "agent-1", result: "pass" },
      { agent_id: "agent-1", result: "violation" },
    ];
    expect(await hasOpenPolicyViolation("tenant-a", "policy-1")).toBe(false);
  });

  it("returns true when any OTHER agent's most recent evaluation is a violation, even if the first agent passes", async () => {
    evaluationRows = [
      { agent_id: "agent-1", result: "pass" },
      { agent_id: "agent-2", result: "violation" },
    ];
    expect(await hasOpenPolicyViolation("tenant-a", "policy-1")).toBe(true);
  });

  it("does not count an 'exempted' result as a violation", async () => {
    evaluationRows = [{ agent_id: "agent-1", result: "exempted" }];
    expect(await hasOpenPolicyViolation("tenant-a", "policy-1")).toBe(false);
  });
});

describe("isExceptionInForce — which policy exceptions may suppress a violation", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("applies an active, started, unexpired exception", () => {
    expect(isExceptionInForce({ status: "active", start_date: "2026-09-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z" }, now)).toBe(true);
  });

  it("applies an active exception with no expiry", () => {
    expect(isExceptionInForce({ status: "active", start_date: "2026-09-01T00:00:00Z", expires_at: null }, now)).toBe(true);
  });

  it("never applies a revoked exception, even one that has not expired", () => {
    expect(isExceptionInForce({ status: "revoked", start_date: "2026-09-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" }, now)).toBe(false);
    expect(isExceptionInForce({ status: "revoked", start_date: null, expires_at: null }, now)).toBe(false);
  });

  it("does not apply an exception before its start date", () => {
    expect(isExceptionInForce({ status: "active", start_date: "2026-10-01T00:00:00Z", expires_at: null }, now)).toBe(false);
  });

  it("does not apply an expired exception", () => {
    expect(isExceptionInForce({ status: "active", start_date: "2026-01-01T00:00:00Z", expires_at: "2026-09-25T11:59:59Z" }, now)).toBe(false);
  });

  it("treats a row without the 0053 columns as the backfilled default (active)", () => {
    expect(isExceptionInForce({ expires_at: null }, now)).toBe(true);
  });
});
