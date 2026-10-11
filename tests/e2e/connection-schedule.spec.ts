import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * INTEGRATION-P0-20 — every connection that reads has a sync schedule, set
 * in the console and through the API, not only file connections. Another
 * organization and a read-only member cannot change it.
 */

const stamp = Date.now();
let id = "";

test.describe.serial("connection schedule", () => {
  test.use({ storageState: authFile("adminOne") });

  test("an API connection's schedule is set through the API and shown on its page", async ({ request, page }) => {
    const res = await request.post("/api/v1/integrations/connectors/connect", {
      data: { origin: "builtin", key: "keycloak", name: `E2E Schedule ${stamp}`, settings: { baseUrl: "https://sso.example.test", realm: "e2e" } },
    });
    expect(res.status(), await res.text()).toBe(201);
    id = (await res.json()).data.integration.id as string;

    expect((await (await request.get(`/api/v1/integrations/${id}/schedule`)).json()).data).toEqual({ schedule: "manual" });
    expect((await request.put(`/api/v1/integrations/${id}/schedule`, { data: { schedule: "weekly" } })).status()).toBe(400);
    const set = await request.put(`/api/v1/integrations/${id}/schedule`, { data: { schedule: "daily" } });
    expect(set.status(), await set.text()).toBe(200);
    expect((await (await request.get(`/api/v1/integrations/${id}/schedule`)).json()).data).toEqual({ schedule: "daily" });

    await page.goto(`/integrations/${id}`);
    await expect(page.getByLabel("Sync schedule")).toHaveValue("daily");
    await page.getByLabel("Sync schedule").selectOption("hourly");
    await page.getByLabel("Sync schedule").locator("xpath=ancestor::form").getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await (await request.get(`/api/v1/integrations/${id}/schedule`)).json()).data.schedule).toBe("hourly");
  });

  test("another organization and a read-only member cannot change it", async ({ browser }) => {
    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await other.request.get(`/api/v1/integrations/${id}/schedule`)).status()).toBe(404);
    expect((await other.request.put(`/api/v1/integrations/${id}/schedule`, { data: { schedule: "manual" } })).status()).toBe(404);
    await other.close();
    const viewer = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await viewer.request.put(`/api/v1/integrations/${id}/schedule`, { data: { schedule: "manual" } })).status()).toBe(403);
    await viewer.close();
  });
});
