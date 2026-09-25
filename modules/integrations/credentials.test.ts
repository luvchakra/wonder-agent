// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const authenticate = vi.fn();
const testConnection = vi.fn();
const createConnectorMock = vi.fn(() => ({ authenticate, testConnection }));
vi.mock("./registry", () => ({ createConnector: () => createConnectorMock() }));

vi.mock("@/lib/security/encryptSecret", () => ({
  encryptSecret: vi.fn(async (s: string) => `enc(${s})`),
  decryptSecret: vi.fn(async (s: string) => s.replace(/^enc\(|\)$/g, "")),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

// Every read and write in setCredential is filtered by id and tenant
// (QA-P0-17), so each chain has two .eq() calls before its terminal.
const updateFn = vi.fn(() => ({ eq: () => ({ eq: vi.fn(async () => ({ error: null })) }) }));
const insertFn = vi.fn(async () => ({ error: null }));
let existingCredentialRow: { integration_id: string } | null = { integration_id: "int-1" };

function makeQuery(table: string) {
  const row =
    table === "integration_credentials"
      ? () => existingCredentialRow
      : () => ({ id: "int-1", integration_type_id: "generic_rest", config: {} });
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row(), error: null }),
        }),
      }),
    }),
    update: updateFn,
    insert: insertFn,
  };
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({ from: (table: string) => makeQuery(table) }),
}));

import { setCredential } from "./credentials";
import { ApiError } from "@/lib/shared/types/foundation";

beforeEach(() => {
  vi.clearAllMocks();
  createConnectorMock.mockReturnValue({ authenticate, testConnection });
  existingCredentialRow = { integration_id: "int-1" };
});

describe("setCredential — INTEGRATION-P0-05.1 verified rotation", () => {
  it("does not persist a replacement credential that fails connection verification", async () => {
    testConnection.mockResolvedValue({ ok: false, message: "401 Unauthorized" });

    await expect(
      setCredential("tenant-1", "user-1", "int-1", "api_key", "bad-secret"),
    ).rejects.toBeInstanceOf(ApiError);

    expect(authenticate).toHaveBeenCalledWith({}, "bad-secret");
    expect(testConnection).toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("persists and audits a replacement credential that passes verification", async () => {
    testConnection.mockResolvedValue({ ok: true });

    await setCredential("tenant-1", "user-1", "int-1", "api_key", "good-secret");

    expect(updateFn).toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "integration.credential_rotated" }),
    );
  });

  it("skips verification for an integration type with no connector implementation", async () => {
    createConnectorMock.mockImplementation(() => {
      throw new Error("No connector implementation for integration type: webhook");
    });

    await setCredential("tenant-1", "user-1", "int-1", "api_key", "any-secret");

    expect(testConnection).not.toHaveBeenCalled();
    expect(updateFn).toHaveBeenCalled();
  });

  it("inserts (rather than updates) and audits credential_set when no prior credential exists", async () => {
    existingCredentialRow = null;
    testConnection.mockResolvedValue({ ok: true });

    await setCredential("tenant-1", "user-1", "int-1", "api_key", "first-secret");

    expect(insertFn).toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "integration.credential_set" }));
  });
});
