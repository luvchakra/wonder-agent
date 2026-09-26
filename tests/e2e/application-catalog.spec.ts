import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * ACCESS-P0-15 — the application catalog against the real app and
 * database: registration with owners and classification, validation,
 * updates, filters, the detail page, and the negative cases (another
 * organization's apps and people, a read-only role).
 */

const stamp = Date.now();
let appId = "";
let ownerId = "";

test.describe.serial("application catalog", () => {
  test.use({ storageState: authFile("adminOne") });

  test("registering validates input and starts the application as Discovered", async ({ request }) => {
    const owner = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E App Owner ${stamp}`, email: `e2e-app-owner-${stamp}@example.test` } });
    ownerId = (await owner.json()).data.id;
    expect((await request.post("/api/v1/access/applications", { data: { name: `E2E Cat ${stamp}`, url: "http://insecure.example.com" } })).status()).toBe(400);
    expect((await request.post("/api/v1/access/applications", { data: { name: `E2E Cat ${stamp}`, appType: "mainframe" } })).status()).toBe(400);

    const res = await request.post("/api/v1/access/applications", {
      data: {
        name: `E2E Cat ${stamp}`,
        appType: "saas",
        vendor: "Acme",
        url: "https://acme.example.com",
        businessOwnerIdentityId: ownerId,
        riskLevel: "high",
        dataClassification: "confidential",
        onboardingStatus: "ACTIVE",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const app = (await res.json()).data;
    appId = app.id;
    expect(app).toMatchObject({ appType: "saas", vendor: "Acme", businessOwnerIdentityId: ownerId, riskLevel: "high", onboardingStatus: "DISCOVERED", discoverySource: "manual" });
    expect((await request.post("/api/v1/access/applications", { data: { name: `E2E Cat ${stamp}` } })).status()).toBe(409);
  });

  test("an owner must be an active person of this organization", async ({ request }) => {
    const svc = await request.post("/api/v1/identities", { data: { identityType: "SERVICE_ACCOUNT", displayName: `svc-cat-${stamp}`, ownerIdentityId: ownerId } });
    const svcId = (await svc.json()).data.id;
    expect((await request.patch(`/api/v1/access/applications/${appId}`, { data: { technicalOwnerIdentityId: svcId } })).status()).toBe(400);
    const ok = await request.patch(`/api/v1/access/applications/${appId}`, { data: { technicalOwnerIdentityId: ownerId, criticality: "critical" } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).data).toMatchObject({ technicalOwnerIdentityId: ownerId, criticality: "critical", onboardingStatus: "DISCOVERED" });
  });

  test("the inventory filters and the detail page shows the catalog", async ({ page }) => {
    await page.goto(`/access?q=${encodeURIComponent(`E2E Cat ${stamp}`)}&risk=high`);
    await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(`E2E Cat ${stamp}`) });
    await expect(row).toBeVisible();
    await expect(row.locator("span.rounded-full", { hasText: "Discovered" })).toBeVisible();
    await page.goto(`/access?q=${encodeURIComponent(`E2E Cat ${stamp}`)}&risk=low`);
    await expect(page.getByText("No applications match")).toBeVisible();

    await page.goto(`/access/applications/${appId}`);
    await expect(page.getByRole("heading", { level: 1, name: `E2E Cat ${stamp}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `E2E App Owner ${stamp}` }).first()).toBeVisible();
    await page.getByLabel("Vendor").fill("Acme Corp");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByText("Acme Corp").first()).toBeVisible();
  });
});

test.describe("application catalog — other organizations and roles", () => {
  test("another organization cannot read, change or borrow owners; read-only cannot register", async ({ browser }) => {
    const one = await browser.newContext({ storageState: authFile("adminOne") });
    const person = await one.request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Cat Iso ${stamp}` } });
    const personId = (await person.json()).data.id;
    const app = await one.request.post("/api/v1/access/applications", { data: { name: `E2E Cat Iso ${stamp}` } });
    const isoAppId = (await app.json()).data.id;
    await one.close();

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.get(`/api/v1/access/applications/${isoAppId}`)).status()).toBe(404);
    expect((await two.request.patch(`/api/v1/access/applications/${isoAppId}`, { data: { riskLevel: "low" } })).status()).toBe(404);
    expect((await two.request.post("/api/v1/access/applications", { data: { name: `E2E Cat Borrow ${stamp}`, businessOwnerIdentityId: personId } })).status()).toBe(404);
    const page = await two.newPage();
    await page.goto(`/access/applications/${isoAppId}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get(`/api/v1/access/applications/${isoAppId}`)).status()).toBe(200);
    expect((await ro.request.post("/api/v1/access/applications", { data: { name: "forged" } })).status()).toBe(403);
    expect((await ro.request.patch(`/api/v1/access/applications/${isoAppId}`, { data: { riskLevel: "low" } })).status()).toBe(403);
    await ro.close();
  });
});
