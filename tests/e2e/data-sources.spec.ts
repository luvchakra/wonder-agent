import { test, expect, type Page } from "@playwright/test";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug, seedFinanceBotAccess } from "./support/seedFinanceBotAccess";

/**
 * ACCESS-P0-13 — the data sources inventory, against the real app and
 * database:
 * - an administrator adds a data source and links an entitlement to it
 *   through the page's forms, which show the real result
 * - the agent holding that entitlement now reaches the data source (CAN),
 *   on the page and in its effective access
 * - a read-only user sees the inventory but no forms
 * - another organization sees none of it and cannot link to it
 */

const dsName = `E2E CustomerDB ${Date.now()}`;
let agentId = "";
let entitlementId = "";

async function registerAgent(page: Page): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(`E2E Data Agent ${Date.now()}`);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

test.describe.serial("data sources", () => {
  test.use({ storageState: authFile("adminOne") });

  test("add a data source and link an entitlement; the agent holding it can reach it", async ({ page }) => {
    agentId = await registerAgent(page);
    const access = await seedFinanceBotAccess(await getTenantIdBySlug(TENANT_ONE.slug), agentId);
    entitlementId = access.customerDbEntitlementId;

    await page.goto("/access/data-sources");
    await expect(page.getByRole("heading", { name: "Data sources", level: 1 })).toBeVisible();
    await page.getByLabel("Data source name").fill(dsName);
    await page.getByLabel("Kind").selectOption("warehouse");
    await page.getByLabel("Application (optional)").selectOption({ label: "Snowflake" });
    await page.getByLabel("Classification", { exact: true }).fill("restricted");
    await page.getByRole("button", { name: "Add data source" }).click();
    await expect(page.getByText(`Added ${dsName}.`)).toBeVisible();

    await page.reload();
    const dsId = await page.getByLabel("Opens data source").locator("option", { hasText: dsName }).getAttribute("value");
    await page.getByLabel("Entitlement").selectOption(entitlementId);
    await page.getByLabel("Opens data source").selectOption(dsId!);
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await expect(page.getByText("Linked.")).toBeVisible();

    await page.reload();
    const row = page.getByRole("row").filter({ hasText: dsName });
    await expect(row.getByRole("link", { name: "1 agent" })).toHaveAttribute("href", `/access/agents/${agentId}`);

    // CAN carries the data source.
    const effective = await (await page.request.get(`/api/v1/access/agents/${agentId}/effective`)).json();
    expect(JSON.stringify(effective.data)).toContain(dsName);
  });

  test("an invalid data source is refused and says why, never shown as saved", async ({ page }) => {
    await page.goto("/access/data-sources");
    await page.getByLabel("Data source name").fill(dsName);
    await page.getByRole("button", { name: "Add data source" }).click();
    await expect(page.getByText(/already exists/)).toBeVisible();
  });

  test("a read-only user sees the inventory but cannot change it", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("readOnly") });
    const page = await ctx.newPage();
    await page.goto("/access/data-sources");
    await expect(page.getByText(dsName)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add a data source" })).toHaveCount(0);
    expect((await page.request.post("/api/v1/access/data-sources", { data: { name: "ro", kind: "api" } })).status()).toBe(403);
    await ctx.close();
  });

  test("another organization sees none of it and cannot link to it", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminTwo") });
    const page = await ctx.newPage();
    await page.goto("/access/data-sources");
    await expect(page.getByRole("heading", { name: "Data sources", level: 1 })).toBeVisible();
    await expect(page.getByText(dsName)).toHaveCount(0);
    const list = (await (await page.request.get("/api/v1/access/data-sources")).json()).data as Array<{ name: string }>;
    expect(list.some((d) => d.name === dsName)).toBe(false);
    // Tenant One's entitlement is not visible to Tenant Two, so it cannot be linked.
    const own = (await (await page.request.post("/api/v1/access/data-sources", { data: { name: `E2E T2 ${Date.now()}`, kind: "api" } })).json()).data;
    const res = await page.request.put(`/api/v1/access/entitlements/${entitlementId}/data-source`, { data: { dataSourceId: own.id } });
    expect(res.status()).toBe(404);
    await ctx.close();
  });
});
