// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * importFileForObject with storage faked: the file is checked before
 * anything is stored or created, it becomes an upload of the tenant's File
 * imports connection, and the sync runs inline for a small file and in the
 * background for a large one.
 */

let existing: Record<string, unknown> | null = null;
const createIntegration = vi.fn();
const storeConnectorFile = vi.fn();
const createSyncJob = vi.fn();
const runSyncJob = vi.fn();
const after = vi.fn();
const writeAudit = vi.fn();
const eqCalls: [string, unknown][] = [];

vi.mock("next/server", () => ({ after: (fn: unknown) => after(fn) }));
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (col: string, v: unknown) => {
        eqCalls.push([col, v]);
        return c;
      };
      c.maybeSingle = async () => ({ data: existing, error: null });
      return c;
    },
  }),
}));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
vi.mock("./integrations", () => ({ createIntegration: (...a: unknown[]) => createIntegration(...a) }));
vi.mock("./syncJobs", () => ({ createSyncJob: (...a: unknown[]) => createSyncJob(...a), runSyncJob: (...a: unknown[]) => runSyncJob(...a) }));
vi.mock("./framework/files", () => ({ storeConnectorFile: (...a: unknown[]) => storeConnectorFile(...a) }));

import { importFileForObject } from "./fileImports";
import { FileImportInvalidError } from "./fileImportRules";
import type { TenantContext } from "@/lib/shared/types/foundation";

const ctx = { userId: "user-1", tenantId: "tenant-a", tenantSlug: "a", roles: [], permissions: ["integration.execute"] } as unknown as TenantContext;

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  existing = null;
  createIntegration.mockResolvedValue({ id: "conn-1", status: "configured" });
  storeConnectorFile.mockResolvedValue({ id: "file-1", sha256: "f".repeat(64), byteSize: 10 });
  createSyncJob.mockResolvedValue({ id: "job-1" });
});

describe("importFileForObject", () => {
  it("refuses a file whose columns cannot fill the kind, before creating or storing anything", async () => {
    await expect(importFileForObject(ctx, "account", "a.csv", "Name\nAda\n")).rejects.toMatchObject({ code: "INVALID_FILE", details: [{ row: 1, column: "externalId" }] });
    await expect(importFileForObject(ctx, "identity", "a.csv", "id\n")).rejects.toBeInstanceOf(FileImportInvalidError);
    await expect(importFileForObject(ctx, "policy", "a.csv", "id\n1\n")).rejects.toBeInstanceOf(FileImportInvalidError);
    expect(createIntegration).not.toHaveBeenCalled();
    expect(storeConnectorFile).not.toHaveBeenCalled();
  });

  it("creates the File imports connection once, stores the file as its upload, and syncs a small file before answering", async () => {
    const result = await importFileForObject(ctx, "identity", "people.csv", "Employee ID,Email\nE1,a@x.test\n");
    expect(eqCalls).toContainEqual(["tenant_id", "tenant-a"]);
    expect(createIntegration).toHaveBeenCalledWith("tenant-a", "user-1", expect.objectContaining({ integrationTypeId: "connector", name: "File imports", config: expect.objectContaining({ purpose: "file_imports" }) }));
    expect(storeConnectorFile).toHaveBeenCalledWith("tenant-a", "conn-1", expect.objectContaining({ kind: "identity", filename: "people.csv", rowCount: 1, createdBy: "user-1" }));
    expect(createSyncJob).toHaveBeenCalledWith("tenant-a", "conn-1", "manual");
    expect(runSyncJob).toHaveBeenCalledWith("tenant-a", "job-1");
    expect(after).not.toHaveBeenCalled();
    expect(writeAudit.mock.calls[0][0]).toMatchObject({ action: "integration.file_imported", actorId: "user-1", metadata: { kind: "identity", rows: 1 } });
    expect(JSON.stringify(writeAudit.mock.calls[0][0])).not.toContain("a@x.test");
    expect(result).toEqual({ jobId: "job-1", integrationId: "conn-1", fileId: "file-1", rows: 1, sync: "completed" });
  });

  it("reuses the existing connection and syncs a large file in the background", async () => {
    existing = { id: "conn-9", status: "connected", config: { definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings: {}, purpose: "file_imports" } };
    const rows = Array.from({ length: 5001 }, (_, i) => `A${i},app`).join("\n");
    const result = await importFileForObject(ctx, "application", "apps.csv", `id,name\n${rows}\n`);
    expect(createIntegration).not.toHaveBeenCalled();
    expect(runSyncJob).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ integrationId: "conn-9", rows: 5001, sync: "running" });
  });

  it("refuses a disabled File imports connection, and a kind it reads from an address", async () => {
    existing = { id: "conn-9", status: "disabled", config: { definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings: {} } };
    await expect(importFileForObject(ctx, "identity", null, "id\n1\n")).rejects.toMatchObject({ status: 409 });
    existing = { id: "conn-9", status: "connected", config: { definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings: { identityUrl: "https://hr.example.test/p.csv" } } };
    await expect(importFileForObject(ctx, "identity", null, "id\n1\n")).rejects.toMatchObject({ status: 409 });
    expect(storeConnectorFile).not.toHaveBeenCalled();
  });
});
