// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const INTEGRATION = { id: "11111111-1111-4111-8111-111111111111", tenant_id: "tenant-a", name: "Claude Desktop MCP" };
let integrationRow: typeof INTEGRATION | null = INTEGRATION;
const upserts: Array<Record<string, unknown>> = [];
let upsertError: { message: string } | null = null;

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === "integrations" ? integrationRow : null, error: null }),
        upsert: async (row: Record<string, unknown>) => (upserts.push(row), { error: upsertError }),
      };
      return chain;
    },
  }),
}));
const audits: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: async (e: Record<string, unknown>) => void audits.push(e) }));
vi.mock("./credentials", () => ({ getDecryptedCredential: async () => "s3cret-token" }));
const ingest = vi.fn();
const quarantine = vi.fn(async () => undefined);
vi.mock("@/modules/runtime-assurance/service", () => ({
  ingestRuntimeEventByReference: (...a: unknown[]) => ingest(...a),
  quarantineEvent: (...a: unknown[]) => quarantine(...(a as [])),
}));

import { ApiError } from "@/lib/shared/types/foundation";
import { ingestMcpRuntimeEvent, parseMcpEvent } from "./mcpEvents";

const event = (over: Record<string, unknown> = {}) => ({
  externalId: "evt-1",
  agentIdentityRef: "svc-finance",
  eventTime: "2026-09-25T10:00:00Z",
  source: "rest",
  tool: "query",
  application: "Snowflake",
  resource: "CustomerDB",
  action: "READ",
  success: true,
  ...over,
});

beforeEach(() => {
  integrationRow = INTEGRATION;
  upserts.length = 0;
  audits.length = 0;
  upsertError = null;
  ingest.mockReset();
  quarantine.mockClear();
});

describe("parseMcpEvent", () => {
  it("keeps known fields, forces the MCP source and drops anything else", () => {
    const e = parseMcpEvent({ ...event(), tenantId: "tenant-b" });
    expect(e).toMatchObject({ source: "mcp", agentIdentityRef: "svc-finance", action: "READ" });
    expect(e).not.toHaveProperty("tenantId");
  });

  it("rejects malformed bodies", () => {
    expect(parseMcpEvent([])).toMatch(/JSON object/);
    expect(parseMcpEvent(event({ action: undefined }))).toMatch(/^action/);
    expect(parseMcpEvent(event({ eventTime: "yesterday" }))).toMatch(/^eventTime/);
    expect(parseMcpEvent(event({ success: "yes" }))).toMatch(/^success/);
    expect(parseMcpEvent(event({ tool: "x".repeat(201) }))).toMatch(/^tool/);
  });
});

describe("ingestMcpRuntimeEvent (INTEGRATION-P0-07)", () => {
  it("authenticates in constant time and refuses a wrong or missing token before touching the body", async () => {
    expect(await ingestMcpRuntimeEvent(INTEGRATION.id, null, event())).toMatchObject({ ok: false, status: 401 });
    expect(await ingestMcpRuntimeEvent(INTEGRATION.id, "wrong", event())).toMatchObject({ ok: false, status: 401 });
    expect(await ingestMcpRuntimeEvent(INTEGRATION.id, "wrong", "not even json")).toMatchObject({ ok: false, status: 401 });
    expect(await ingestMcpRuntimeEvent("not-a-uuid", "s3cret-token", event())).toMatchObject({ ok: false, status: 404 });
    expect(upserts).toEqual([]);
  });

  it("buffers the event and records it in runtime_events under the integration's tenant, idempotently", async () => {
    ingest.mockResolvedValue({ event: { id: "re-1" }, deduped: false });
    const result = await ingestMcpRuntimeEvent(INTEGRATION.id, "s3cret-token", event());
    expect(result).toEqual({ ok: true, runtime: "recorded" });
    expect(upserts[0]).toMatchObject({ tenant_id: "tenant-a", object_type: "activity", external_id: "evt-1" });
    expect(ingest).toHaveBeenCalledWith(
      "tenant-a",
      null,
      "svc-finance",
      expect.objectContaining({ source: "mcp", mcpServer: "Claude Desktop MCP", dedupeKey: `mcp:${INTEGRATION.id}:evt-1`, resource: "CustomerDB" }),
    );
    expect(audits[0]).toMatchObject({ action: "integration.mcp_event_ingested", metadata: expect.objectContaining({ runtime: "recorded" }) });

    ingest.mockResolvedValue({ event: { id: "re-1" }, deduped: true });
    expect(await ingestMcpRuntimeEvent(INTEGRATION.id, "s3cret-token", event())).toEqual({ ok: true, runtime: "duplicate" });
  });

  it("states truthfully when Runtime quarantined the event instead of recording it", async () => {
    for (const [code, runtime] of [
      ["AGENT_NOT_REGISTERED", "quarantined_unregistered_agent"],
      ["AGENT_REFERENCE_AMBIGUOUS", "quarantined_ambiguous_agent"],
      ["REPLAY_WINDOW_VIOLATION", "quarantined_replay_window"],
      ["FEATURE_DISABLED", "monitoring_disabled"],
    ] as const) {
      ingest.mockRejectedValueOnce(new ApiError(404, code));
      expect(await ingestMcpRuntimeEvent(INTEGRATION.id, "s3cret-token", event())).toEqual({ ok: true, runtime });
    }
  });

  it("an event with no agent reference is quarantined, never attributed", async () => {
    const result = await ingestMcpRuntimeEvent(INTEGRATION.id, "s3cret-token", event({ agentIdentityRef: undefined }));
    expect(result).toEqual({ ok: true, runtime: "quarantined_missing_agent_reference" });
    expect(ingest).not.toHaveBeenCalled();
    expect(quarantine).toHaveBeenCalledWith("tenant-a", "MISSING_AGENT_REFERENCE", expect.objectContaining({ source: "mcp" }));
  });

  it("a failure is reported as a failure, never as success", async () => {
    upsertError = { message: "db down" };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ingestMcpRuntimeEvent(INTEGRATION.id, "s3cret-token", event())).toMatchObject({ ok: false, status: 500 });
    upsertError = null;
    ingest.mockRejectedValue(new Error("boom"));
    expect(await ingestMcpRuntimeEvent(INTEGRATION.id, "s3cret-token", event())).toMatchObject({ ok: false, status: 500, reason: expect.stringMatching(/retry/) });
    log.mockRestore();
  });
});
