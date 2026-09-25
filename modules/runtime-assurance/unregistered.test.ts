// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const quarantined: Array<[string, string, Record<string, unknown>]> = [];
vi.mock("./quarantine", () => ({
  quarantineEvent: async (tenantId: string, reason: string, details: Record<string, unknown>) => void quarantined.push([tenantId, reason, details]),
}));
let monitoring = true;
vi.mock("@/modules/platform-admin/service", () => ({
  requireFeature: async () => {
    if (!monitoring) throw Object.assign(new Error("off"), { status: 403, code: "FEATURE_DISABLED" });
  },
}));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: vi.fn(), supabaseServiceRole: vi.fn() }));
const resolve = vi.fn();
vi.mock("@/modules/agent-identity/service", () => ({ resolveAgentReference: (...a: unknown[]) => resolve(...a) }));
const ingest = vi.fn();
vi.mock("./events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./events")>()),
  ingestRuntimeEvent: (...a: unknown[]) => ingest(...a),
}));

import { groupUnregisteredActivity, ingestRuntimeEventByReference, quarantineUnresolvedAgentEvent } from "./unregistered";

const details = (eventTime = new Date().toISOString()) => ({
  observedAgentRef: "svc-bot",
  source: "mcp",
  action: "READ",
  application: "Snowflake",
  tool: "query",
  submittedEventTime: eventTime,
  attemptedDedupeKey: null,
});

beforeEach(() => {
  quarantined.length = 0;
  monitoring = true;
  resolve.mockReset();
  ingest.mockReset();
});

describe("quarantineUnresolvedAgentEvent (IDENTITY-P0-12)", () => {
  it("an unregistered agent's event is quarantined as discovery evidence and refused with 404, never recorded", async () => {
    await expect(quarantineUnresolvedAgentEvent("t1", "none", details())).rejects.toMatchObject({ status: 404, code: "AGENT_NOT_REGISTERED" });
    expect(quarantined).toEqual([["t1", "UNREGISTERED_AGENT", expect.objectContaining({ observedAgentRef: "svc-bot", tool: "query" })]]);
  });

  it("an ambiguous reference is quarantined for review with 409; the system never picks one", async () => {
    await expect(quarantineUnresolvedAgentEvent("t1", "ambiguous", details())).rejects.toMatchObject({ status: 409, code: "AGENT_REFERENCE_AMBIGUOUS" });
    expect(quarantined[0][1]).toBe("AMBIGUOUS_AGENT");
  });

  it("an event outside the replay window is quarantined as a replay, not as Shadow AI evidence", async () => {
    await expect(quarantineUnresolvedAgentEvent("t1", "none", details("2020-01-01T00:00:00Z"))).rejects.toMatchObject({ status: 422 });
    expect(quarantined[0][1]).toBe("REPLAY_WINDOW_VIOLATION");
  });

  it("with runtime monitoring off for the tenant nothing is collected", async () => {
    monitoring = false;
    await expect(quarantineUnresolvedAgentEvent("t1", "none", details())).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    expect(quarantined).toEqual([]);
  });
});

describe("groupUnregisteredActivity", () => {
  it("groups by reference with counts, first and last seen and distinct evidence, newest first", () => {
    const rows = [
      { observed_agent_ref: "a", source: "mcp", application: "Snowflake", tool: "q", action: "READ", received_at: "2026-09-25T10:00:00Z" },
      { observed_agent_ref: "b", source: "rest", application: null, tool: null, action: "READ", received_at: "2026-09-25T09:00:00Z" },
      { observed_agent_ref: "a", source: "mcp", application: "SAP", tool: "q", action: "WRITE", received_at: "2026-09-24T10:00:00Z" },
      { observed_agent_ref: null, source: "mcp", application: null, tool: null, action: "READ", received_at: "2026-09-25T11:00:00Z" },
    ];
    expect(groupUnregisteredActivity(rows)).toEqual([
      { agentRef: "a", eventCount: 2, firstSeenAt: "2026-09-24T10:00:00Z", lastSeenAt: "2026-09-25T10:00:00Z", sources: ["mcp"], applications: ["SAP", "Snowflake"], tools: ["q"], actions: ["READ", "WRITE"] },
      { agentRef: "b", eventCount: 1, firstSeenAt: "2026-09-25T09:00:00Z", lastSeenAt: "2026-09-25T09:00:00Z", sources: ["rest"], applications: [], tools: [], actions: ["READ"] },
    ]);
  });
});

describe("ingestRuntimeEventByReference (IDENTITY-P0-12 / INTEGRATION-P0-07)", () => {
  const input = { eventTime: new Date().toISOString(), source: "mcp" as const, action: "READ", success: true, tool: "query", application: "Snowflake" };

  it("a resolved reference is ingested as that agent, with the resolved identity", async () => {
    resolve.mockResolvedValue({ kind: "unique", agentId: "agent-1", identityId: "identity-1" });
    ingest.mockResolvedValue({ event: { id: "e1" }, deduped: false });
    await ingestRuntimeEventByReference("t1", "user-1", "svc-finance", input);
    expect(resolve).toHaveBeenCalledWith("t1", "svc-finance");
    expect(ingest).toHaveBeenCalledWith("t1", "user-1", expect.objectContaining({ agentId: "agent-1", identityId: "identity-1" }));
    expect(quarantined).toEqual([]);
  });

  it("an unresolved reference is never ingested", async () => {
    resolve.mockResolvedValue({ kind: "none" });
    await expect(ingestRuntimeEventByReference("t1", null, "ghost", input)).rejects.toMatchObject({ code: "AGENT_NOT_REGISTERED" });
    expect(ingest).not.toHaveBeenCalled();
    expect(quarantined[0][1]).toBe("UNREGISTERED_AGENT");
  });

  it("a replay-window rejection from ingestion is quarantined against the resolved agent", async () => {
    const { ApiError } = await import("@/lib/shared/types/foundation");
    resolve.mockResolvedValue({ kind: "unique", agentId: "agent-1", identityId: null });
    ingest.mockRejectedValue(new ApiError(422, "REPLAY_WINDOW_VIOLATION"));
    await expect(ingestRuntimeEventByReference("t1", null, "svc-finance", input)).rejects.toMatchObject({ status: 422 });
    expect(quarantined[0]).toEqual(["t1", "REPLAY_WINDOW_VIOLATION", expect.objectContaining({ agentId: "agent-1", observedAgentRef: "svc-finance" })]);
  });
});
