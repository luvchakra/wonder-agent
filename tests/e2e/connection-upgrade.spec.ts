import { test, expect, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * INTEGRATION-P0-21 part 4 — sharing a connection type and upgrading a
 * connection, against a local stub system.
 * - A connection type downloads as a file that opens (validates) again.
 * - A newer version shows as available on the connection; its preview
 *   lists the mapping change and changes nothing.
 * - A version that needs a credential the connection lacks is blocked.
 * - Upgrading moves the connection, never widens changes in the system,
 *   and the next sync reads in full with the new mapping.
 */

const stamp = Date.now();
const KEY = `e2e-upgrade-${stamp}`;
let stub: Server;
let baseUrl = "";
let integrationId = "";
let tenantId = "";
const seen: string[] = [];

function definition(version: string, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    key: KEY,
    version,
    name: `E2E Upgrade ${stamp}`,
    category: "application",
    description: "A stub system for connection upgrades (INTEGRATION-P0-21).",
    driver: "http",
    settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
    auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "Token" }] },
    test: { request: { path: "/ping" } },
    resources: { account: { request: { path: "/users" }, records: "", fields: { externalId: "id", username: "login" } } },
    ...extra,
  };
}

async function syncAndWait(request: APIRequestContext) {
  const res = await request.post(`/api/v1/integrations/${integrationId}/sync`);
  expect(res.status(), await res.text()).toBe(202);
  const jobId = (await res.json()).data.id as string;
  await expect
    .poll(async () => ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string }[]).find((j) => j.id === jobId)?.status, { timeout: 60_000 })
    .toMatch(/succeeded|partial|failed/);
  return ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string; mode?: string }[]).find((j) => j.id === jobId)!;
}

test.beforeAll(async () => {
  stub = createServer((req, res) => {
    seen.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url === "/ping") return res.end("{}");
    if (req.url === "/users") return res.end(JSON.stringify([{ id: "u-1", login: "ANA", name: "Ana Example" }]));
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => stub?.close(resolve));
});

test.describe.serial("connection types: sharing and upgrading", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a connection type downloads as a file that is a valid definition", async ({ request }) => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    expect((await request.post("/api/v1/integrations/connectors", { data: definition("1.0.0") })).status()).toBe(201);
    const file = await request.get(`/api/v1/integrations/connectors/custom/${KEY}/export?version=1.0.0`);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-disposition"]).toContain(`${KEY}-1.0.0.json`);
    const exported = await file.json();
    expect(exported).toMatchObject({ key: KEY, version: "1.0.0" });
    expect(JSON.stringify(exported)).not.toMatch(/e2e-token/);
    // Opening it again: the same key and version is already published, so it is refused as a duplicate, not as invalid.
    const again = await request.post("/api/v1/integrations/connectors", { data: exported });
    expect((await again.json()).error.code).toBe("VERSION_EXISTS");
  });

  test("a newer version is offered, previewed, and blocked when it needs a credential the connection lacks", async ({ request, page }) => {
    const connected = await request.post("/api/v1/integrations/connectors/connect", { data: { origin: "custom", key: KEY, name: `E2E Upgrade ${stamp}`, settings: { baseUrl }, secret: { token: "e2e-token" } } });
    expect(connected.status(), await connected.text()).toBe(201);
    integrationId = (await connected.json()).data.integration.id;
    expect((await syncAndWait(request)).status).toBe("succeeded");

    const v11 = definition("1.1.0", {
      resources: { account: { request: { path: "/users" }, records: "", fields: { externalId: "id", username: { path: "login", transform: ["lower"] }, displayName: "name" } } },
    });
    expect((await request.post("/api/v1/integrations/connectors", { data: v11 })).status()).toBe(201);
    const needsKey = definition("1.2.0", { auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "Token" }, { key: "org", label: "Organization id" }] } });
    expect((await request.post("/api/v1/integrations/connectors", { data: needsKey })).status()).toBe(201);

    const blocked = await request.get(`/api/v1/integrations/${integrationId}/upgrade?version=1.2.0`);
    expect((await blocked.json()).data.blockers.join(" ")).toMatch(/Organization id/);
    expect((await request.post(`/api/v1/integrations/${integrationId}/upgrade`, { data: { version: "1.2.0" } })).status()).toBe(409);

    // FOUNDATION-P0-34: an old link with the id redirects to the connection's number.
    await page.goto(`/integrations/${integrationId}`);
    await expect(page).toHaveURL(/\/integrations\/\d+$/);
    await page.getByRole("link", { name: "v1.2.0 available" }).click();
    await expect(page).toHaveURL(/\/integrations\/\d+\/upgrade\?version=1\.2\.0$/);
    await expect(page.getByRole("heading", { name: "Upgrade to v1.2.0" })).toBeVisible();
    await expect(page.getByText("This upgrade cannot run yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade" })).toHaveCount(0);
  });

  test("upgrading moves the connection, and the next sync reads in full with the new mapping", async ({ request, page }) => {
    test.setTimeout(120_000);
    await page.goto(`/integrations/${integrationId}/upgrade?version=1.1.0`);
    await expect(page.getByText(/username is mapped differently/)).toBeVisible();
    await expect(page.getByText(/new field displayName/)).toBeVisible();
    await page.getByRole("button", { name: "Upgrade" }).click();
    await page.waitForURL(/\/integrations\/\d+\?upgraded=1\.1\.0$/);
    await expect(page.getByText("Upgraded to v1.1.0.")).toBeVisible();

    const job = await syncAndWait(request);
    expect(job.status).toBe("succeeded");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: staged } = await db.from("integration_objects").select("normalized").eq("tenant_id", tenantId).eq("integration_id", integrationId).eq("external_id", "u-1").maybeSingle();
    expect(staged?.normalized).toMatchObject({ username: "ana", displayName: "Ana Example" });
    const { data: audit } = await db.from("audit_logs").select("action, metadata").eq("tenant_id", tenantId).eq("object_id", integrationId).eq("action", "integration.definition_upgraded");
    expect(audit?.[0]?.metadata).toMatchObject({ from: "1.0.0", to: "1.1.0", writes: "none" });
  });
});
