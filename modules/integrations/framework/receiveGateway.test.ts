// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The receiving side routes every request through the Connector Gateway:
 * a disabled connection is refused there, and each request (accepted,
 * unauthenticated or refused) lands in the same traffic ledger as the
 * outbound traffic, with no body, sender address or secret.
 */

const CONNECTION = "6a4e3c1d-0000-4000-8000-000000000001";
const SECRET = "wr_RECEIVER-SECRET";
let integrationRow: Record<string, unknown> | null;
const rpc = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: 1, error: null }));
const upsert = vi.fn(async () => ({ error: null }));

function table(name: string) {
  const single = async () => {
    if (name === "integrations") return { data: integrationRow, error: null };
    if (name === "connector_receivers") return { data: { encrypted_secret: SECRET }, error: null };
    return { data: null, error: null };
  };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = single;
  chain.update = () => chain;
  chain.upsert = upsert;
  chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
  return chain;
}

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: table, rpc }) }));
vi.mock("@/lib/security/encryptSecret", () => ({ decryptSecret: async (s: string) => s, encryptSecret: async (s: string) => s }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/agentApiKeys", () => ({ bearerAgentKey: () => null, verifyAgentApiKey: async () => null }));
vi.mock("@/modules/runtime-assurance/service", () => ({
  authorizeRuntimeRequest: vi.fn(),
  filterGatewayTools: vi.fn(),
  ingestRuntimeEventByReference: vi.fn(),
  parseGatewayRequest: vi.fn(),
  quarantineEvent: vi.fn(),
}));

import { receive } from "./receive";
import { webhook } from "./definitions/webhook";

const body = JSON.stringify({ id: "evt-1", type: "user.updated" });
const signed = () => new Headers({ "x-webhook-signature": createHmac("sha256", SECRET).update(body).digest("hex") });
const recorded = () => (rpc.mock.calls.at(-1)?.[1] as { p_rows: Record<string, unknown>[] }).p_rows;

beforeEach(() => {
  rpc.mockClear();
  upsert.mockClear();
  integrationRow = {
    id: CONNECTION,
    tenant_id: "tenant-a",
    name: "Signed events",
    status: "connected",
    integration_type_id: "connector",
    config: { definition: { key: "webhook", version: "1.0.0", origin: "builtin" }, manifest: webhook, settings: {} },
  };
});

describe("receiving through the Connector Gateway", () => {
  it("records an accepted request as inbound traffic of the connection's own organization", async () => {
    const result = await receive(CONNECTION, "webhook", body, signed());
    expect(result.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("record_connector_traffic", expect.anything());
    expect(recorded()).toEqual([
      expect.objectContaining({ tenant_id: "tenant-a", integration_id: CONNECTION, direction: "inbound", operation: "receive webhook", host: null, outcome: "ok", requests: 1, bytes_in: body.length }),
    ]);
  });

  it("records a sender that fails authentication as blocked, with no secret material", async () => {
    const result = await receive(CONNECTION, "webhook", body, new Headers({ "x-webhook-signature": "deadbeef" }));
    expect(result.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
    expect(recorded()[0]).toMatchObject({ outcome: "blocked", error_category: "unauthenticated" });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/RECEIVER-SECRET|deadbeef|evt-1/);
  });

  it("refuses a disabled connection at the gateway, before any channel runs, and records it", async () => {
    integrationRow = { ...integrationRow!, status: "disabled" };
    const result = await receive(CONNECTION, "webhook", body, signed());
    expect(result.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
    expect(recorded()[0]).toMatchObject({ outcome: "blocked", error_category: "disabled", tenant_id: "tenant-a" });
  });

  it("records nothing for a connection that does not exist: there is no organization to account it to", async () => {
    integrationRow = null;
    expect((await receive(CONNECTION, "webhook", body, signed())).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
