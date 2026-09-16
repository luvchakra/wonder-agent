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

test.describe("Risk module", () => {
  test.use({ storageState: authFile("adminOne") });

  test("list page and rogue-agents page load", async ({ page }) => {
    await page.goto("/risk");
    await expect(page.getByRole("heading", { name: "Risk", exact: true })).toBeVisible();

    await page.goto("/risk/rogue");
    await expect(page.getByRole("heading", { name: "Rogue Agents" })).toBeVisible();
  });

  test("a fresh agent has zero open findings, and a risk evaluation runs without error", async ({ page }) => {
    const agentName = `E2E Risk Agent ${Date.now()}`;
    const agentId = await registerAgent(page, agentName);
    await page.goto(`/risk/agents/${agentId}`);

    await expect(page.getByRole("heading", { name: agentName })).toBeVisible();
    await expect(page.getByText("Risk & Findings — 0 open findings of 0 total.")).toBeVisible();

    await page.getByRole("button", { name: "Run risk evaluation now" }).click();
    await expect(page).toHaveURL(`/risk/agents/${agentId}`);
    await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
  });
});
