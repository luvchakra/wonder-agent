import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * INTEGRATION-P0-07 (codebase-map D6) — MCP runtime events reach Runtime,
 * against the real app and database, through the MCP connection's
 * receiving side (non-negotiable #20):
 * - the receiver refuses a missing or wrong connection secret
 * - an event for an agent nobody registered is accepted but quarantined,
 *   and says so; it then shows up as Shadow AI
 * - once that agent is registered, its MCP events are recorded as runtime
 *   activity (DID) for it, and a redelivery is a duplicate, not a second
 *   event
 */

let secret = "";
const ref = `e2e-mcp-agent-${Date.now()}`;
let integrationId = "";
let agentId = "";
let anon: APIRequestContext;
// Connecting an MCP server reads it, so the spec runs a minimal local MCP
// server that answers initialize and tools/list.
let mcpStub: Server;
let mcpStubUrl = "";

const post = (data: Record<string, unknown>, token: string | null = secret) =>
  anon.post(`/api/connect/v1/${integrationId}/events`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    data: { eventTime: new Date().toISOString(), action: "READ", success: true, tool: "query_customers", application: "Snowflake", ...data },
  });

test.describe.serial("MCP events bridge into runtime", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async ({ baseURL }) => {
    anon = await playwrightRequest.newContext({ baseURL });
    mcpStub = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const msg = JSON.parse(raw || "{}");
        if (msg.id === undefined) return res.writeHead(202).end();
        const result = msg.method === "initialize" ? { protocolVersion: "2025-06-18", serverInfo: { name: "e2e-mcp", version: "1" } } : { tools: [] };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      });
    });
    await new Promise<void>((resolve) => mcpStub.listen(0, "127.0.0.1", resolve));
    mcpStubUrl = `http://127.0.0.1:${(mcpStub.address() as AddressInfo).port}/mcp`;
  });
  test.afterAll(async () => {
    await anon?.dispose();
    await new Promise((resolve) => mcpStub?.close(resolve));
  });

  test("setup: an MCP connection, and its receiving secret", async ({ page }) => {
    await page.goto("/integrations/connectors/builtin/mcp-server");
    await page.getByLabel("Name").fill(`E2E MCP ${Date.now()}`);
    await page.getByLabel("MCP endpoint").fill(mcpStubUrl);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page).toHaveURL(/\/integrations\/[0-9a-f-]{36}$/);
    integrationId = page.url().split("/integrations/")[1];
    await expect(page.getByText(`/api/connect/v1/${integrationId}/events`)).toBeVisible();
    await page.getByRole("button", { name: "Issue secret" }).click();
    // Wait for the real server result: the secret, shown once.
    const shown = page.getByRole("status").locator("code");
    await expect(shown).toHaveText(/^wr_/);
    secret = (await shown.textContent())!.trim();
  });

  test("refuses a missing or wrong secret", async () => {
    expect((await post({ externalId: "x", agentIdentityRef: ref }, null)).status()).toBe(401);
    expect((await post({ externalId: "x", agentIdentityRef: ref }, "wrong")).status()).toBe(401);
  });

  test("an unregistered agent's event is accepted but quarantined, and says so", async ({ page }) => {
    const res = await post({ externalId: `u2-${Date.now()}`, agentIdentityRef: ref });
    expect((await res.json()).data.runtime).toBe("quarantined_unregistered_agent");
    expect((await (await post({ externalId: `nr-${Date.now()}` })).json()).data.runtime).toBe("quarantined_missing_agent_reference");
    expect((await post({ externalId: "bad", agentIdentityRef: ref, success: "yes" })).status()).toBe(400);

    await page.goto("/agents/discovery?tab=shadow_ai");
    await expect(page.getByRole("link", { name: ref })).toBeVisible();
  });

  test("once registered, its MCP events are recorded as its runtime activity, once", async ({ page }) => {
    await page.goto("/agents/discovery?tab=shadow_ai");
    await page.getByRole("link", { name: ref }).click();
    await page.getByLabel("Agent type").fill("automation");
    await page.getByLabel("Purpose").fill("E2E MCP bridge");
    await page.getByRole("button", { name: "Register Agent" }).click();
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
    agentId = page.url().split("/agents/")[1];

    const externalId = `rec-${Date.now()}`;
    expect((await (await post({ externalId, agentIdentityRef: ref, resource: "CustomerDB" })).json()).data.runtime).toBe("recorded");
    expect((await (await post({ externalId, agentIdentityRef: ref, resource: "CustomerDB" })).json()).data.runtime).toBe("duplicate");

    const events = (await (await page.request.get(`/api/v1/runtime/events?agentId=${agentId}`)).json()).data as Array<{ source: string; resource: string }>;
    expect(events.filter((e) => e.source === "mcp" && e.resource === "CustomerDB")).toHaveLength(1);

    // It counts as DID for that agent.
    const did = (await (await page.request.get(`/api/v1/runtime/agents/${agentId}/did`)).json()).data;
    expect(JSON.stringify(did)).toContain("CustomerDB");
  });

  test("another organization sees none of it", async ({ browser }) => {
    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    const page = await other.newPage();
    const res = await page.request.get(`/api/v1/runtime/events?agentId=${agentId}`);
    const body = await res.json();
    expect(body.data ?? []).toEqual([]);
    await page.goto("/agents/discovery?tab=shadow_ai");
    await expect(page.getByText(ref)).toHaveCount(0);
    await other.close();
  });
});
