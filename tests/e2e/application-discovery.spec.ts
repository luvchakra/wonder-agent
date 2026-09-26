import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";
import { replaceIntegrationObjects, seedIntegrationWithAccounts } from "./support/seedIntegrationAccounts";

/**
 * INTEGRATION-P0-10 — application discovery against the real app and
 * database: a connector's imported applications are matched to the catalog
 * (on name or host only) or held as unrecognized with a suggestion; a
 * later discovery adds a sighting and never undoes a decision; register
 * (through Access's catalog, with owners and the connector), link,
 * exception and ignore with a reason; OpenAPI, SCIM and manual reports.
 * Other organizations and read-only roles see and change nothing.
 */

const stamp = Date.now();
const knownName = `E2E Disc Known ${stamp}`;
const knownHost = `https://known-${stamp}.example.com`;
let knownId = "";
let integrationId = "";

type Discovery = { id: string; name: string; status: string; applicationId: string | null; suggestedApplicationId: string | null; sightings: number; source: string };

async function discoveries(request: APIRequestContext, q: string) {
  const res = await request.get(`/api/v1/integrations/discoveries?status=all&q=${encodeURIComponent(q)}&pageSize=200`);
  expect(res.status()).toBe(200);
  return (await res.json()).data as Discovery[];
}
const byName = async (request: APIRequestContext, name: string) => (await discoveries(request, name)).find((d) => d.name === name)!;
const decide = (request: APIRequestContext, id: string, data: Record<string, unknown>) => request.post(`/api/v1/integrations/discoveries/${id}`, { data });

test.describe.serial("application discovery", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a connector's applications are matched on name or host, or held as unrecognized", async ({ request }) => {
    const known = await request.post("/api/v1/access/applications", { data: { name: knownName, url: knownHost } });
    expect(known.status(), await known.text()).toBe(201);
    knownId = (await known.json()).data.id;

    integrationId = await seedIntegrationWithAccounts(TENANT_ONE.slug, `E2E Disc Connector ${stamp}`, []);
    const tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    await replaceIntegrationObjects(integrationId, tenantId, "application", [
      { externalId: "K", raw: { name: `Login portal ${stamp}`, url: `${knownHost}/login` } },
      { externalId: "U1", raw: { name: `E2E Disc Shadow ${stamp}`, vendor: "ShadowCo" } },
      { externalId: "U2", raw: { name: `${knownName} Sandbox` } },
      { externalId: "N", raw: { vendor: "Nameless" } },
    ]);

    expect((await request.post("/api/v1/integrations/discoveries", { data: { kind: "integration", integrationId: "not-an-id" } })).status()).toBe(400);
    const run = await request.post("/api/v1/integrations/discoveries", { data: { kind: "integration", integrationId } });
    expect(run.status(), await run.text()).toBe(201);
    expect((await run.json()).data).toEqual({ found: 3, created: 3, seenAgain: 0, matched: 1, unrecognized: 2, skipped: 1 });

    expect(await byName(request, `Login portal ${stamp}`)).toMatchObject({ status: "MATCHED", applicationId: knownId, source: "integration" });
    expect(await byName(request, `E2E Disc Shadow ${stamp}`)).toMatchObject({ status: "UNRECOGNIZED", applicationId: null, suggestedApplicationId: null });
    // A resemblance is only a suggestion.
    expect(await byName(request, `${knownName} Sandbox`)).toMatchObject({ status: "UNRECOGNIZED", applicationId: null, suggestedApplicationId: knownId });
  });

  test("ignoring needs a reason, stays on record, and a later discovery does not undo it", async ({ request }) => {
    const shadow = await byName(request, `E2E Disc Shadow ${stamp}`);
    expect((await decide(request, shadow.id, { action: "ignore" })).status()).toBe(400);
    expect((await decide(request, shadow.id, { action: "fly" })).status()).toBe(400);
    const ignored = await decide(request, shadow.id, { action: "ignore", note: "Personal trial, no company data" });
    expect(ignored.status(), await ignored.text()).toBe(200);
    expect((await decide(request, shadow.id, { action: "ignore", note: "again" })).status()).toBe(409);

    const again = await request.post("/api/v1/integrations/discoveries", { data: { kind: "integration", integrationId } });
    expect((await again.json()).data).toMatchObject({ found: 3, created: 0, seenAgain: 3 });
    expect(await byName(request, `E2E Disc Shadow ${stamp}`)).toMatchObject({ status: "IGNORED", sightings: 2 });

    // Reopened, then an exception needs a reason and a future end date.
    expect((await decide(request, shadow.id, { action: "reopen", note: "Now holds customer data" })).status()).toBe(200);
    expect((await decide(request, shadow.id, { action: "exception", note: "Pilot", exceptionUntil: "2020-01-01" })).status()).toBe(400);
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const exc = await decide(request, shadow.id, { action: "exception", note: "Pilot until the contract review", exceptionUntil: future });
    expect((await exc.json()).data).toMatchObject({ status: "EXCEPTION", exceptionUntil: future });
  });

  test("the suggestion is linked by a person; another discovery is registered with owners and the connector", async ({ request }) => {
    const sandbox = await byName(request, `${knownName} Sandbox`);
    expect((await decide(request, sandbox.id, { action: "link", applicationId: "00000000-0000-4000-8000-000000000000" })).status()).toBe(404);
    const linked = await decide(request, sandbox.id, { action: "link", applicationId: knownId, note: "Same tenant, sandbox login" });
    expect((await linked.json()).data).toMatchObject({ status: "MATCHED", applicationId: knownId });

    // A fresh unrecognized one from the same connector, registered.
    const tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    await replaceIntegrationObjects(integrationId, tenantId, "application", [{ externalId: "R1", raw: { name: `E2E Disc Register ${stamp}`, url: `https://reg-${stamp}.example.com` } }]);
    await request.post("/api/v1/integrations/discoveries", { data: { kind: "integration", integrationId } });
    const toRegister = await byName(request, `E2E Disc Register ${stamp}`);
    const owner = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Disc Owner ${stamp}`, email: `e2e-disc-owner-${stamp}@example.test` } });
    const ownerId = (await owner.json()).data.id;
    const reg = await decide(request, toRegister.id, {
      action: "register",
      connect: true,
      application: { appType: "saas", businessOwnerIdentityId: ownerId, technicalOwnerIdentityId: ownerId, riskLevel: "high", dataClassification: "confidential" },
    });
    expect(reg.status(), await reg.text()).toBe(200);
    const registered = (await reg.json()).data as Discovery;
    expect(registered.status).toBe("REGISTERED");
    const app = (await (await request.get(`/api/v1/access/applications/${registered.applicationId}`)).json()).data;
    expect(app).toMatchObject({ name: `E2E Disc Register ${stamp}`, discoverySource: "integration", sourceIntegrationId: integrationId, businessOwnerIdentityId: ownerId, riskLevel: "high", onboardingStatus: "DISCOVERED" });
  });

  test("OpenAPI, SCIM and manual reports; a repeated document is a sighting, not a duplicate", async ({ request }) => {
    const doc = JSON.stringify({ openapi: "3.0.3", info: { title: `E2E Disc API ${stamp}`, version: "1" }, servers: [{ url: `https://api-${stamp}.example.com` }], paths: { "/a": {} } });
    const first = await request.post("/api/v1/integrations/discoveries", { data: { kind: "openapi", document: doc } });
    expect(first.status(), await first.text()).toBe(201);
    expect((await first.json()).data).toMatchObject({ source: "openapi", status: "UNRECOGNIZED", url: `https://api-${stamp}.example.com` });
    const second = await request.post("/api/v1/integrations/discoveries", { data: { kind: "openapi", document: doc } });
    expect(second.status()).toBe(200);
    expect((await second.json()).data.sightings).toBe(2);
    expect((await request.post("/api/v1/integrations/discoveries", { data: { kind: "openapi", document: "openapi: 3" } })).status()).toBe(400);

    const scim = { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"], patch: { supported: true } };
    expect((await request.post("/api/v1/integrations/discoveries", { data: { kind: "scim", name: "x", baseUrl: "http://scim.example.com", metadata: JSON.stringify(scim) } })).status()).toBe(400);
    const s = await request.post("/api/v1/integrations/discoveries", { data: { kind: "scim", name: `E2E Disc SCIM ${stamp}`, baseUrl: `https://scim-${stamp}.example.com/v2`, metadata: JSON.stringify(scim) } });
    expect((await s.json()).data).toMatchObject({ source: "scim", evidence: { patch: true } });
    // The address in a document is recorded, never called: an internal one is simply stored text.
    const m = await request.post("/api/v1/integrations/discoveries", { data: { kind: "manual", name: `E2E Disc Manual ${stamp}`, url: "ftp://nope" } });
    expect(m.status()).toBe(400);
  });

  test("the screens record a report and ignore it with a reason", async ({ page }) => {
    await page.goto("/integrations/discovery");
    await expect(page.getByRole("heading", { level: 1, name: "Application discovery" })).toBeVisible();
    await page.getByRole("combobox", { name: "From" }).selectOption("manual");
    await page.getByRole("textbox", { name: /Application name/ }).fill(`E2E Disc UI ${stamp}`);
    await page.getByRole("button", { name: "Record discovery" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `E2E Disc UI ${stamp}` })).toBeVisible();
    await expect(page.getByText("Not in the catalog.")).toBeVisible();

    await page.getByRole("radio", { name: "Ignore" }).check();
    await page.getByRole("textbox", { name: /Reason/ }).fill("Duplicate of a report already handled");
    await page.getByRole("button", { name: "Ignore", exact: true }).click();
    await expect(page.getByText("Ignored. It stays on record.")).toBeVisible();

    await page.goto(`/integrations/discovery?status=IGNORED&q=${encodeURIComponent(`E2E Disc UI ${stamp}`)}`);
    await expect(page.getByRole("link", { name: `E2E Disc UI ${stamp}` })).toBeVisible();
  });

  test("another organization sees none of it; read-only reads but cannot discover or decide", async ({ browser, request }) => {
    const target = await byName(request, `${knownName} Sandbox`);
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.get(`/api/v1/integrations/discoveries/${target.id}`)).status()).toBe(404);
    expect((await decide(two.request, target.id, { action: "reopen" })).status()).toBe(404);
    expect((await two.request.post("/api/v1/integrations/discoveries", { data: { kind: "integration", integrationId } })).status()).toBe(404);
    expect(await discoveries(two.request, `E2E Disc`)).toEqual([]);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get(`/api/v1/integrations/discoveries/${target.id}`)).status()).toBe(200);
    expect((await ro.request.post("/api/v1/integrations/discoveries", { data: { kind: "manual", name: "x" } })).status()).toBe(403);
    expect((await decide(ro.request, target.id, { action: "reopen" })).status()).toBe(403);
    await ro.close();
  });
});
