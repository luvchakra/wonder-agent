// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: 1, error: null }));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ rpc }) }));

import { openGateway } from "./gateway";
import { DefinitionConnector } from "../framework/engine";
import type { FileStoreFactory } from "../framework/drivers/file";
import type { GuardedInit } from "../outboundFetch";

const config = (settings: Record<string, unknown> = {}) => ({ definition: { key: "csv-file", version: "1.0.0", origin: "builtin" }, settings });

describe("the file driver in the Connector Gateway", () => {
  it("fetches a CSV address through the gateway's transport and accounts it by host", async () => {
    const calls: { url: string; init: GuardedInit }[] = [];
    const transport = vi.fn(async (url: string, init: GuardedInit) => {
      calls.push({ url, init });
      return new Response("id,name\nsap,SAP\n", { status: 200 });
    });
    const gateway = openGateway({ tenantId: "tenant-a", integrationId: "int-1", status: "connected" }, { transport, sleep: async () => undefined });
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate(config({ applicationUrl: "https://files.example.test/apps.csv?sig=abc" }), null);
    expect((await connector.importKind("application")).map((r) => r.normalized)).toEqual([{ externalId: "sap", name: "SAP" }]);
    await gateway.flush();
    expect(calls[0].init).toMatchObject({ maxBytes: 10 * 1024 * 1024 });
    const rows = (rpc.mock.calls[0][1] as { p_rows: Record<string, unknown>[] }).p_rows;
    expect(rows[0]).toMatchObject({ tenant_id: "tenant-a", integration_id: "int-1", direction: "outbound", operation: "file GET", host: "files.example.test" });
    expect(JSON.stringify(rows)).not.toContain("sig=abc");
  });

  it("reads received files only for the session's own connection, whatever the caller passes", async () => {
    const newest = vi.fn(async () => ({ id: "f1", filename: "people.csv", content: "id\nE1\n" }));
    const fileStore = vi.fn(() => ({ newest, markRead: async () => undefined })) as unknown as FileStoreFactory;
    const gateway = openGateway({ tenantId: "tenant-a", integrationId: "int-1", status: "connected" }, { fileStore });
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate(config(), null, { tenantId: "tenant-b", integrationId: "int-9" });
    expect(await connector.importKind("identity")).toHaveLength(1);
    expect(fileStore).toHaveBeenCalledWith({ tenantId: "tenant-a", integrationId: "int-1" });

    // A preview (no connection) reads none.
    const preview = openGateway({ tenantId: "tenant-a", integrationId: null }, { fileStore });
    const c2 = new DefinitionConnector(preview.drivers);
    await c2.authenticate(config(), null);
    expect(await c2.importKind("identity")).toEqual([]);
    expect(fileStore).toHaveBeenCalledTimes(1);
  });

  it("refuses a disabled connection's address before calling it", async () => {
    const transport = vi.fn(async () => new Response("id\n1\n"));
    const gateway = openGateway({ tenantId: "tenant-a", integrationId: "int-1", status: "disabled" }, { transport });
    const connector = new DefinitionConnector(gateway.drivers);
    await connector.authenticate(config({ identityUrl: "https://files.example.test/p.csv" }), null);
    await expect(connector.importKind("identity")).rejects.toThrow(/disabled/);
    expect(transport).not.toHaveBeenCalled();
  });
});
