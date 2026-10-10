// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DefinitionConnector } from "./engine";
import { fileDriver, type ConnectorFileStore, type FileFetch, type StoredFile } from "./drivers/file";
import { csvFile } from "./definitions/csv-file";
import { validateDefinition } from "./validate";
import { uploadFilename, uploadTarget } from "./receiveRules";
import type { ConnectorDefinition, ResourceKind } from "./types";

const config = (settings: Record<string, unknown> = {}) => ({ definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings });

function fakeFetch(files: Record<string, { status?: number; body: string }>) {
  const calls: { url: string; headers?: Record<string, string>; maxBytes?: number }[] = [];
  const fetch: FileFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, maxBytes: init.maxBytes });
    const f = files[url];
    return new Response(f?.body ?? "", { status: f ? (f.status ?? 200) : 404 });
  };
  return { fetch, calls };
}

function fakeStore(files: Partial<Record<ResourceKind, StoredFile>>) {
  const read: string[] = [];
  const store: ConnectorFileStore = {
    newest: async (kind) => files[kind] ?? null,
    markRead: async (_kind, file) => {
      read.push(file.id);
    },
  };
  return { factory: vi.fn(() => store), read };
}

describe("the file driver", () => {
  it("fetches a CSV address with the connection's token and a 10 MB cap, and maps its columns", async () => {
    const { fetch, calls } = fakeFetch({
      "https://hr.example.test/people.csv": { body: "Employee ID,First Name,Last Name,Work Email,Manager ID,Hire Date,Status\nE1,Ada,Lovelace,ADA@X.TEST,,2024-01-31,Active\nE2,Grace,Hopper,grace@x.test,E1,,Active\n" },
    });
    const c = new DefinitionConnector({ file: fileDriver({ fetch }) });
    await c.authenticate(config({ identityUrl: "https://hr.example.test/people.csv" }), JSON.stringify({ token: "t0k" }));
    const records = await c.importKind("identity");
    expect(calls[0]).toMatchObject({ url: "https://hr.example.test/people.csv", headers: expect.objectContaining({ Authorization: "Bearer t0k" }), maxBytes: 10 * 1024 * 1024 });
    expect(records.map((r) => r.normalized)).toEqual([
      { externalId: "E1", firstName: "Ada", lastName: "Lovelace", email: "ada@x.test", startDate: "2024-01-31", status: "active" },
      { externalId: "E2", firstName: "Grace", lastName: "Hopper", email: "grace@x.test", managerExternalId: "E1", status: "active" },
    ]);
  });

  it("applies the connection's column renames and default application", async () => {
    const { fetch } = fakeFetch({
      "https://files.example.test/accounts.csv": { body: "Login,Account No,Admin,Groups\nada,A1,yes,\"finance, reporting\"\n" },
    });
    const c = new DefinitionConnector({ file: fileDriver({ fetch }) });
    await c.authenticate(config({ accountUrl: "https://files.example.test/accounts.csv", application: "SAP", columns: "account.externalId = Account No" }), null);
    expect((await c.importKind("account"))[0].normalized).toEqual({
      externalId: "A1",
      username: "ada",
      privileged: true,
      entitlements: ["finance", "reporting"],
      application: "SAP",
    });
  });

  it("reports a row it cannot map with its row number, and fails a malformed file", async () => {
    const { fetch } = fakeFetch({
      "https://f.example.test/ok.csv": { body: "id,email\n,nobody@x.test\n2,b@x.test\n" },
      "https://f.example.test/bad.csv": { body: "id,email\n1,\"a@x\n" },
      "https://f.example.test/gone.csv": { status: 404, body: "" },
    });
    const c = new DefinitionConnector({ file: fileDriver({ fetch }) });
    await c.authenticate(config({ identityUrl: "https://f.example.test/ok.csv" }), null);
    expect(await c.importKind("identity")).toHaveLength(1);
    expect(c.drainIssues()).toEqual([{ objectType: "identity", message: "identity: no value for externalId (row 2)" }]);

    await c.authenticate(config({ identityUrl: "https://f.example.test/bad.csv" }), null);
    await expect(c.importKind("identity")).rejects.toThrow(/row 2: line 2: a quoted field is never closed/);
    await c.authenticate(config({ identityUrl: "https://f.example.test/gone.csv?sig=secret" }), null);
    await expect(c.importKind("identity")).rejects.toThrow("GET f.example.test/gone.csv failed: HTTP 404");
  });

  it("reads the newest received file for a kind with no address, and marks it read when the run closes", async () => {
    const { fetch, calls } = fakeFetch({});
    const { factory, read } = fakeStore({ application: { id: "f1", filename: "apps.csv", content: "Application ID,Name\nsap,SAP\n" } });
    const c = new DefinitionConnector({ file: fileDriver({ fetch, store: factory }) });
    await c.authenticate(config(), null, { tenantId: "t1", integrationId: "i1" });
    expect((await c.importKind("application")).map((r) => r.normalized)).toEqual([{ externalId: "sap", name: "SAP" }]);
    expect(await c.importKind("identity")).toEqual([]); // nothing received for this kind
    expect(factory).toHaveBeenCalledWith({ tenantId: "t1", integrationId: "i1" });
    expect(read).toEqual([]);
    await c.close();
    expect(read).toEqual(["f1"]);
    expect(calls).toEqual([]);
  });

  it("imports a WonderID export back: canonical headers in any case, unknown columns ignored", async () => {
    const { factory } = fakeStore({
      account: { id: "f2", filename: "accounts-export.csv", content: "externalId,APPLICATION,userName,accountType,Risk Score,Last Reviewed\nacc-1,SAP,ada,Human,82,2026-09-01\n" },
    });
    const c = new DefinitionConnector({ file: fileDriver({ fetch: fakeFetch({}).fetch, store: factory }) });
    await c.authenticate(config(), null, { tenantId: "t1", integrationId: "i1" });
    expect((await c.importKind("account"))[0].normalized).toEqual({ externalId: "acc-1", application: "SAP", username: "ada", accountType: "human" });
  });

  it("reads no received files without a stored connection (a preview)", async () => {
    const { factory } = fakeStore({ identity: { id: "f1", filename: null, content: "id\n1\n" } });
    const c = new DefinitionConnector({ file: fileDriver({ fetch: fakeFetch({}).fetch, store: factory }) });
    await c.authenticate(config(), null);
    expect(await c.importKind("identity")).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it("tests each address it reads, and passes with none (it only receives)", async () => {
    const { fetch } = fakeFetch({ "https://f.example.test/p.csv": { body: "name\nAda\n" } });
    const c = new DefinitionConnector({ file: fileDriver({ fetch }) });
    await c.authenticate(config(), null);
    expect(await c.testConnection()).toEqual({ ok: true });
    await c.authenticate(config({ identityUrl: "https://f.example.test/p.csv" }), null);
    expect(await c.testConnection()).toMatchObject({ ok: false, message: expect.stringMatching(/no column for externalId/) });
  });
});

describe("validating a file definition", () => {
  const base = (patch: Partial<ConnectorDefinition>) => ({ ...csvFile, key: "acme-csv", ...patch });

  it("accepts the built-in csv-file", () => {
    expect(validateDefinition(csvFile).issues).toEqual([]);
  });

  it("takes an address only from a url setting, renames only from a string setting", () => {
    const r = { ...(csvFile.resources.identity as object), file: { url: "https://evil.test/x.csv", columns: "{settings.identityUrl}" } };
    const paths = validateDefinition(base({ resources: { identity: r as never } })).issues.map((i) => i.path);
    expect(paths).toEqual(["resources.identity.file.url", "resources.identity.file.columns"]);
  });

  it("needs an address or the file receiver, one file per kind, and no MCP kinds or forEach", () => {
    const fields = { externalId: "id" };
    const issues = validateDefinition(
      base({
        receive: undefined,
        resources: { identity: { fields }, account: [{ fields, file: { url: "{settings.accountUrl}" } }], mcp_tool: { fields: { externalId: "id", name: "n" }, file: { url: "{settings.identityUrl}" } } },
      }),
    ).issues.map((i) => `${i.path}: ${i.message}`);
    expect(issues).toEqual(
      expect.arrayContaining([
        "resources.identity.file.url: is required unless the connector receives files (receive.file)",
        "resources.account: a file connector reads one file per kind",
        expect.stringMatching(/^resources.mcp_tool: a file connector reads/),
      ]),
    );
  });

  it("allows file auth types and no test; receive.file only on a file connector", () => {
    expect(validateDefinition(base({ auth: { type: "oauth2_client_credentials" } as never })).issues[0].path).toBe("auth.type");
    expect(validateDefinition(base({ test: { request: { path: "/x" } } })).issues[0].path).toBe("test");
    const http = validateDefinition({ ...base({}), driver: "http" }).issues.map((i) => i.path);
    expect(http).toContain("receive.file");
  });
});

describe("a received file's target", () => {
  it("is a kind the connection reads from received files", () => {
    expect(uploadTarget(csvFile, {}, "Identity")).toMatchObject({ kind: "identity" });
    expect(uploadTarget(csvFile, {}, null)).toMatchObject({ status: 400 });
    expect(uploadTarget(csvFile, {}, "mcp_tool")).toMatchObject({ status: 400 });
    expect(uploadTarget(csvFile, { identityUrl: "https://hr.example.test/p.csv" }, "identity")).toMatchObject({ status: 409 });
    expect(uploadTarget({ ...csvFile, receive: undefined }, {}, "identity")).toMatchObject({ status: 404 });
  });

  it("keeps a printable file name of at most 200 characters", () => {
    expect(uploadFilename(" people\u0000.csv ")).toBe("people.csv");
    expect(uploadFilename("x".repeat(300))).toHaveLength(200);
    expect(uploadFilename(null)).toBeNull();
  });
});
