// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `file` receive channel (POST /api/connect/v1/<id>/file), with the
 * database and the sync machinery faked: the order of checks (size, then
 * connection, then the sender's secret, then the file), what is stored,
 * and that nothing is stored for a refused file.
 */

const CONNECTION_ID = "5f0c3a52-8d1e-4e4b-9a57-0b6f3c2d1e00";
let connectionRow: Record<string, unknown> | null;
const storeConnectorFile = vi.fn();
const createSystemSyncJob = vi.fn();
const runSyncJob = vi.fn();
const writeAudit = vi.fn();

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "upsert", "in", "is", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: result, error: null });
  c.then = (resolve: (v: unknown) => void) => resolve({ error: null });
  return c;
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({
    from: (table: string) => {
      if (table === "integrations") return chain(connectionRow);
      if (table === "connector_receivers") return chain({ encrypted_secret: "enc" });
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));
vi.mock("@/lib/security/encryptSecret", () => ({ decryptSecret: async () => "wr_secret", encryptSecret: async (s: string) => s }));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
vi.mock("@/lib/security/agentApiKeys", () => ({ bearerAgentKey: vi.fn(), verifyAgentApiKey: vi.fn() }));
vi.mock("@/modules/runtime-assurance/service", () => ({}));
vi.mock("../syncJobs", () => ({ createSystemSyncJob: (...a: unknown[]) => createSystemSyncJob(...a), runSyncJob: (...a: unknown[]) => runSyncJob(...a) }));
vi.mock("./files", () => ({ storeConnectorFile: (...a: unknown[]) => storeConnectorFile(...a), connectorFileStore: vi.fn() }));
// The Connector Gateway: admits a connection unless it is disabled; its accounting is not under test here.
vi.mock("../gateway/gateway", () => ({
  openGateway: (c: { status?: string }) => ({ admits: () => c.status !== "disabled", recordInbound: vi.fn(), flush: async () => {} }),
}));

import { receive, MAX_RECEIVE_BYTES } from "./receive";

const csv = "Employee ID,Email\nE1,ada@x.test\nE2,grace@x.test\n";
const headers = (h: Record<string, string> = {}) => new Headers({ authorization: "Bearer wr_secret", "x-wonderid-kind": "identity", ...h });

beforeEach(() => {
  vi.clearAllMocks();
  connectionRow = {
    id: CONNECTION_ID,
    tenant_id: "tenant-a",
    name: "HR export",
    status: "connected",
    integration_type_id: "connector",
    config: { definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings: {} },
  };
  storeConnectorFile.mockResolvedValue({ id: "file-1", sha256: "a".repeat(64), byteSize: csv.length });
  createSystemSyncJob.mockResolvedValue({ id: "job-1" });
});

describe("receiving a CSV file", () => {
  it("refuses a body over 10 MB before reading the connection", async () => {
    expect(MAX_RECEIVE_BYTES.file).toBe(10 * 1024 * 1024);
    const r = await receive(CONNECTION_ID, "file", "x".repeat(MAX_RECEIVE_BYTES.file + 1), headers());
    expect(r.status).toBe(413);
    expect(storeConnectorFile).not.toHaveBeenCalled();
  });

  it("refuses a sender without the connection's secret, before looking at the file", async () => {
    for (const h of [headers({ authorization: "Bearer wrong" }), new Headers({ "x-wonderid-kind": "identity" })]) {
      const r = await receive(CONNECTION_ID, "file", "not,a\ncsv", h);
      expect(r.status).toBe(401);
    }
    expect(storeConnectorFile).not.toHaveBeenCalled();
  });

  it("receives nothing for a disabled connection or one that does not take files", async () => {
    connectionRow = { ...connectionRow!, status: "disabled" };
    expect((await receive(CONNECTION_ID, "file", csv, headers())).status).toBe(404);
    connectionRow = { ...connectionRow!, status: "connected", config: { definition: { key: "webhook", version: "1.0.0", origin: "builtin" }, settings: {} } };
    expect((await receive(CONNECTION_ID, "file", csv, headers())).status).toBe(404);
  });

  it("stores a valid file for the connection's own tenant, audits counts only, and starts its sync", async () => {
    const r = await receive(CONNECTION_ID, "file", csv, headers({ "x-wonderid-filename": "people.csv", "x-wonderid-tenant": "tenant-b" }));
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ ok: true, data: { fileId: "file-1", kind: "identity", rows: 2, jobId: "job-1" } });
    expect(storeConnectorFile).toHaveBeenCalledWith("tenant-a", CONNECTION_ID, { kind: "identity", filename: "people.csv", content: csv, rowCount: 2, createdBy: null });
    expect(createSystemSyncJob).toHaveBeenCalledWith("tenant-a", CONNECTION_ID, "manual");
    const audit = writeAudit.mock.calls[0][0];
    expect(audit).toMatchObject({ tenantId: "tenant-a", action: "integration.file_received", metadata: { kind: "identity", rows: 2 } });
    expect(JSON.stringify(audit)).not.toContain("ada@x.test");
    expect(runSyncJob).not.toHaveBeenCalled();
    await r.background?.();
    expect(runSyncJob).toHaveBeenCalledWith("tenant-a", "job-1");
  });

  it("refuses a file it cannot import, with the row and column, storing nothing", async () => {
    const missing = await receive(CONNECTION_ID, "file", "Name\nAda\n", headers());
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: { code: "INVALID_FILE", details: [{ row: 1, column: "externalId" }] } });
    const ragged = await receive(CONNECTION_ID, "file", "id,email\n1\n", headers());
    expect(ragged.body).toMatchObject({ error: { details: [{ row: 2, message: "has 1 fields; the header has 2" }] } });
    const kind = await receive(CONNECTION_ID, "file", csv, headers({ "x-wonderid-kind": "agents" }));
    expect(kind.status).toBe(400);
    expect(storeConnectorFile).not.toHaveBeenCalled();
  });
});
