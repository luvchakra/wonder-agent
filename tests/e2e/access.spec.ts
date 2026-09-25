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

  test("list page shows the applications table and the access-requests link", async ({ page }) => {
    await page.goto("/access");
    await expect(page.getByRole("heading", { name: "Applications" }).first()).toBeVisible();
    await page.getByRole("link", { name: "View access requests →" }).click();
    await expect(page).toHaveURL("/access/requests");
    await expect(page.getByRole("heading", { name: "Access Requests" })).toBeVisible();
  });

  test("adding an external-facing application shows it in the table with an External badge", async ({ page }) => {
    const appName = `E2E App ${Date.now()}`;
    await page.goto("/access");
    await page.getByLabel("Application name").fill(appName);
    // exact: true — the table's filter box is labelled "Filter by name or
    // category…", which a substring match also resolves to.
    await page.getByLabel("Category", { exact: true }).fill("saas");
    await page.getByLabel("External-facing (email, messaging, public API)").check();
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page).toHaveURL("/access");
    // The table pages at 25; filter to the new row rather than assume it is on page one.
    await page.getByLabel("Filter by name or category…").fill(appName);
    const row = page.getByRole("row", { name: new RegExp(appName) });
    await expect(row).toBeVisible();
    // Below `md` the shared table stacks each cell and prints its column
    // label beside the value, so the string "External" appears twice in
    // this row's markup — once as that label (display:none at this
    // width), once as the badge. Target the badge itself.
    await expect(row.locator("span.rounded-full", { hasText: "External" })).toBeVisible();
  });

  test("an agent's Access (CAN) page shows the access graph and effective access sections", async ({ page }) => {
    const agentId = await registerAgent(page, `E2E Access Agent ${Date.now()}`);
    await page.goto(`/access/agents/${agentId}`);

    await expect(page.getByText("Access Graph")).toBeVisible();
    await expect(page.getByText(/Effective Access \(CAN\)/)).toBeVisible();
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
