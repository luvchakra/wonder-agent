// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Importing a CSV from an object page, with storage faked:
 * - the file is checked before anything is stored or created;
 * - the preview stores and changes nothing;
 * - the import stores the file as the File imports connection's upload,
 *   syncs it, and hands what the sync stored to the owning module, never
 *   anything else; a sync that fails adds nothing and says so.
 */

let existing: Record<string, unknown> | null = null;
let jobStatus: { status: string; errors: { message: string }[] | null } = { status: "succeeded", errors: [] };
let storedObjects: Record<string, unknown>[] = [];
const createIntegration = vi.fn();
const storeConnectorFile = vi.fn();
const createSyncJob = vi.fn();
const runSyncJob = vi.fn();
const writeAudit = vi.fn();
const previewAccessImport = vi.fn();
const applyAccessImport = vi.fn();
const listIdentitiesForCorrelation = vi.fn();
const previewSourcedIdentities = vi.fn();
const applySourcedIdentities = vi.fn();
const eqCalls: [string, unknown][] = [];

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "order", "range"]) c[m] = () => c;
  c.eq = (col: string, v: unknown) => {
    eqCalls.push([col, v]);
    return c;
  };
  c.maybeSingle = async () => result();
  c.then = (resolve: (v: unknown) => void) => resolve(result());
  return c;
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({ from: () => chain(() => ({ data: existing, error: null })) }),
  supabaseServiceRole: () => ({
    from: (table: string) => chain(() => (table === "integration_sync_jobs" ? { data: jobStatus, error: null } : { data: storedObjects, error: null })),
  }),
}));
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
vi.mock("./integrations", () => ({ createIntegration: (...a: unknown[]) => createIntegration(...a) }));
vi.mock("./syncJobs", () => ({ createSyncJob: (...a: unknown[]) => createSyncJob(...a), runSyncJob: (...a: unknown[]) => runSyncJob(...a) }));
vi.mock("./framework/files", () => ({ storeConnectorFile: (...a: unknown[]) => storeConnectorFile(...a) }));
vi.mock("@/modules/access-governance/service", () => ({
  previewAccessImport: (...a: unknown[]) => previewAccessImport(...a),
  applyAccessImport: (...a: unknown[]) => applyAccessImport(...a),
}));
vi.mock("@/modules/agent-identity/service", () => ({
  listIdentitiesForCorrelation: (...a: unknown[]) => listIdentitiesForCorrelation(...a),
  previewSourcedIdentities: (...a: unknown[]) => previewSourcedIdentities(...a),
  applySourcedIdentities: (...a: unknown[]) => applySourcedIdentities(...a),
}));

import { importFileForObject, previewFileForObject } from "./fileImports";
import { FileImportInvalidError } from "./fileImportRules";
import type { TenantContext } from "@/lib/shared/types/foundation";

const ctx = { userId: "user-1", tenantId: "tenant-a", tenantSlug: "a", roles: [], permissions: ["integration.execute"] } as unknown as TenantContext;
const ADA = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  existing = null;
  jobStatus = { status: "succeeded", errors: [] };
  storedObjects = [];
  createIntegration.mockResolvedValue({ id: "conn-1", status: "configured" });
  storeConnectorFile.mockResolvedValue({ id: "file-1", sha256: "f".repeat(64), byteSize: 10 });
  createSyncJob.mockResolvedValue({ id: "job-1" });
  listIdentitiesForCorrelation.mockResolvedValue([{ id: ADA, identityType: "HUMAN", displayName: "Ada", email: "ada@x.test", username: null, startDate: null, status: "active", sourceNativeId: null }]);
  previewSourcedIdentities.mockImplementation(async (_t: string, _s: unknown, ops: { op: string; ref: string; identityId?: string }[]) =>
    ops.map((o) => (o.op === "create" ? { ref: o.ref, identityId: null, action: "create", changes: [], skipped: [] } : { ref: o.ref, identityId: o.identityId, action: "update", changes: [{ field: "department", from: null, to: "Ops" }], skipped: [] })),
  );
  applySourcedIdentities.mockImplementation(async (_t: string, _s: unknown, ops: { op: string; ref: string; identityId?: string }[]) =>
    ops.map((o) => ({ ref: o.ref, identityId: o.identityId ?? "new-id", action: o.op === "create" ? "created" : "updated", changed: [], skipped: [] })),
  );
});

describe("checking the file", () => {
  it("refuses a file whose columns cannot fill the kind, before creating or storing anything", async () => {
    await expect(importFileForObject(ctx, "account", null, "a.csv", "Name\nAda\n")).rejects.toMatchObject({ code: "INVALID_FILE", details: [{ row: 1, column: "externalId" }] });
    await expect(importFileForObject(ctx, "identity", null, "a.csv", "id\n")).rejects.toBeInstanceOf(FileImportInvalidError);
    await expect(importFileForObject(ctx, "policy", null, "a.csv", "id\n1\n")).rejects.toBeInstanceOf(FileImportInvalidError);
    await expect(previewFileForObject(ctx, "identity", null, "id,name\nE1,A\nE1,B\n")).rejects.toMatchObject({ details: [{ row: 3 }] });
    await expect(previewFileForObject(ctx, "account", null, "id,username\nu1,ada\n")).rejects.toMatchObject({ message: expect.stringContaining("application column") });
    const big = Array.from({ length: 5001 }, (_, i) => `A${i},app${i}`).join("\n");
    await expect(previewFileForObject(ctx, "application", null, `id,name\n${big}\n`)).rejects.toMatchObject({ message: expect.stringContaining("split the file") });
    expect(createIntegration).not.toHaveBeenCalled();
    expect(storeConnectorFile).not.toHaveBeenCalled();
  });

  it("refuses a disabled File imports connection, and a kind it reads from an address", async () => {
    existing = { id: "conn-9", status: "disabled", config: { definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings: {} } };
    await expect(importFileForObject(ctx, "identity", null, null, "id\n1\n")).rejects.toMatchObject({ status: 409 });
    existing = { id: "conn-9", status: "connected", config: { definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings: { identityUrl: "https://hr.example.test/p.csv" } } };
    await expect(previewFileForObject(ctx, "identity", null, "id\n1\n")).rejects.toMatchObject({ status: 409 });
    expect(storeConnectorFile).not.toHaveBeenCalled();
  });
});

describe("previewFileForObject", () => {
  it("plans every row in the page's columns and stores nothing", async () => {
    const p = await previewFileForObject(ctx, "identity", "people", "Employee ID,Name,Email,Department\nE1,Ada,ada@x.test,Ops\nE2,Bo,,Fin\n,No Id,,\n");
    expect(p.rows).toBe(3);
    expect(p.counts).toEqual({ new: 1, update: 1, unchanged: 0, invalid: 1, review: 0 });
    expect(p.columns).toEqual(["externalId", "displayName", "email", "department"]);
    expect(p.shown.map((r) => [r.row, r.decision])).toEqual([
      [2, "update"],
      [3, "new"],
      [4, "invalid"],
    ]);
    expect(p.shown[0]!.values).toEqual({ externalId: "E1", displayName: "Ada", email: "ada@x.test", department: "Ops" });
    expect(previewSourcedIdentities.mock.calls[0][2]).toEqual([
      { op: "update", ref: "E1", identityId: ADA, fields: { displayName: "Ada", email: "ada@x.test", department: "Ops" } },
      { op: "create", ref: "E2", identityType: "HUMAN", fields: { displayName: "Bo", department: "Fin" }, nativeId: "E2" },
    ]);
    expect(storeConnectorFile).not.toHaveBeenCalled();
    expect(createSyncJob).not.toHaveBeenCalled();
    expect(applySourcedIdentities).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("asks the Access module about its kinds", async () => {
    previewAccessImport.mockResolvedValue([{ row: 2, externalId: "A1", decision: "new", targetId: null, changes: [], note: null }]);
    const p = await previewFileForObject(ctx, "application", "applications", "id,name\nA1,Workday\n");
    expect(previewAccessImport).toHaveBeenCalledWith("tenant-a", "application", [expect.objectContaining({ externalId: "A1" })], { integrationId: null });
    expect(p.counts.new).toBe(1);
  });
});

describe("importFileForObject", () => {
  it("stores the file through the File imports connection, syncs it, then applies only what the sync stored", async () => {
    storedObjects = [{ external_id: "E2", raw: { _row: 2 }, normalized: { externalId: "E2", displayName: "Bo" } }];
    const result = await importFileForObject(ctx, "identity", "people", "people.csv", "Employee ID,Name\nE2,Bo\n");
    expect(createIntegration).toHaveBeenCalledWith("tenant-a", "user-1", expect.objectContaining({ integrationTypeId: "connector", name: "File imports", config: expect.objectContaining({ purpose: "file_imports" }) }));
    expect(storeConnectorFile).toHaveBeenCalledWith("tenant-a", "conn-1", expect.objectContaining({ kind: "identity", filename: "people.csv", rowCount: 1, createdBy: "user-1" }));
    expect(runSyncJob).toHaveBeenCalledWith("tenant-a", "job-1");
    expect(eqCalls).toContainEqual(["sync_job_id", "job-1"]);
    expect(applySourcedIdentities).toHaveBeenCalledWith(
      "tenant-a",
      expect.objectContaining({ sourceId: "conn-1", priority: 1000, sourceName: "File imports", runId: "job-1" }),
      [{ op: "create", ref: "E2", identityType: "HUMAN", fields: { displayName: "Bo" }, nativeId: "E2" }],
    );
    // Additive: no leaver is ever applied.
    expect(applySourcedIdentities.mock.calls.flatMap((c) => c[2] as { op: string }[]).some((o) => o.op === "leaver")).toBe(false);
    expect(result).toEqual({ jobId: "job-1", integrationId: "conn-1", fileId: "file-1", rows: 1, counts: { created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0 }, problems: [] });
    const actions = writeAudit.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["integration.file_imported", "integration.file_applied"]);
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("Bo");
  });

  it("reports rows the mapping refused alongside the applied ones", async () => {
    existing = { id: "conn-9", status: "connected", config: { definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings: {}, purpose: "file_imports" } };
    storedObjects = [{ external_id: "A1", raw: { _row: 2 }, normalized: { externalId: "A1", name: "Workday" } }];
    applyAccessImport.mockResolvedValue([{ row: 2, externalId: "A1", outcome: "created", targetId: "app-1", message: null }]);
    const result = await importFileForObject(ctx, "application", "applications", "apps.csv", "id,name\nA1,Workday\n,Nameless\n");
    expect(createIntegration).not.toHaveBeenCalled();
    expect(applyAccessImport).toHaveBeenCalledWith("tenant-a", "user-1", "application", [{ row: 2, externalId: "A1", values: { externalId: "A1", name: "Workday" } }], { integrationId: "conn-9", jobId: "job-1" });
    expect(result.counts).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 1, failed: 0 });
    expect(result.problems).toEqual([{ row: 3, externalId: "", message: "no value for externalId" }]);
  });

  it("adds nothing when the connection could not read the file, and says so", async () => {
    jobStatus = { status: "failed", errors: [{ message: "The identity file could not be parsed" }] };
    await expect(importFileForObject(ctx, "identity", null, "p.csv", "id,name\nE1,Ada\n")).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Nothing was added") });
    expect(applySourcedIdentities).not.toHaveBeenCalled();
    expect(applyAccessImport).not.toHaveBeenCalled();
  });
});
