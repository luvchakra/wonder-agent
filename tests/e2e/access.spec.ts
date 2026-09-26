import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

async function registerAgent(page: import("@playwright/test").Page, name: string): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(name);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

test.describe("Access module", () => {
  test.use({ storageState: authFile("adminOne") });

  test("the inventory lists applications and links to access requests", async ({ page }) => {
    await page.goto("/access");
    await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();
    await page.getByRole("link", { name: "Access requests" }).click();
    await expect(page).toHaveURL("/access/requests");
    await expect(page.getByRole("heading", { name: "Access Requests" })).toBeVisible();
  });

  test("registering an external-facing application shows it in the catalog with an External badge", async ({ page }) => {
    const appName = `E2E App ${Date.now()}`;
    await page.goto("/access/applications/new");
    await page.getByRole("textbox", { name: /^Name/ }).fill(appName);
    await page.getByLabel("Category").fill("saas");
    await page.getByLabel("External-facing (email, messaging, public API)").check();
    await page.getByRole("button", { name: "Register application" }).click();
    await expect(page).toHaveURL(/\/access\/applications\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: appName })).toBeVisible();

    await page.goto(`/access?q=${encodeURIComponent(appName)}`);
    const row = page.getByRole("row", { name: new RegExp(appName) });
    await expect(row).toBeVisible();
    await expect(row.locator("span.rounded-full", { hasText: "External" })).toBeVisible();
    await expect(row.locator("span.rounded-full", { hasText: "Discovered" })).toBeVisible();
  });

  test("an agent's Access (CAN) page shows the access graph and effective access sections", async ({ page }) => {
    const agentId = await registerAgent(page, `E2E Access Agent ${Date.now()}`);
    await page.goto(`/access/agents/${agentId}`);

    await expect(page.getByText("Access Graph")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Effective Access (CAN)" })).toBeVisible();
    // A freshly registered agent has no accounts/grants yet from this
    // manual-registration path (accounts come from an integration sync).
    await expect(page.getByText("0 grants")).toBeVisible();
  });

  test("running a policy evaluation for an agent with no grants completes without error", async ({ page }) => {
    const agentId = await registerAgent(page, `E2E Evaluate Agent ${Date.now()}`);
    await page.goto(`/access/agents/${agentId}`);
    await page.getByRole("button", { name: "Run evaluation now" }).click();
    await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
  });
});
