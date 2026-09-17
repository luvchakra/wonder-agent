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

test.describe("Runtime module", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a fresh agent's Runtime (DID) page shows an empty SHOULD/CAN/DID comparison", async ({ page }) => {
    const agentId = await registerAgent(page, `E2E Runtime Agent ${Date.now()}`);
    await page.goto(`/runtime/agents/${agentId}`);

    await expect(page.getByText("SHOULD vs CAN vs DID")).toBeVisible();
    await expect(page.getByText("No comparison outcomes yet.")).toBeVisible();
    await expect(page.getByText("No events yet.")).toBeVisible();
  });

  test("submitting a test runtime event records it and updates DID", async ({ page }) => {
    const agentId = await registerAgent(page, `E2E Runtime Event Agent ${Date.now()}`);
    await page.goto(`/runtime/agents/${agentId}`);

    await page.getByLabel("Application").fill("Snowflake");
    await page.getByLabel("Resource").fill("CustomerDB");
    await page.getByLabel("Action").fill("read");
    await page.getByRole("button", { name: "Submit event", exact: true }).click();

    await expect(page).toHaveURL(`/runtime/agents/${agentId}`);
    await expect(page.getByText("No events yet.")).not.toBeVisible();
    // The same event is rendered twice on this page — once in the events
    // table and once in the SHOULD/CAN/DID comparison — so scope to the first.
    const eventRow = page.getByRole("row", { name: /Snowflake.*CustomerDB/ }).first();
    await expect(eventRow).toBeVisible();

    await expect(page.getByText("No comparison outcomes yet.")).not.toBeVisible();
  });
});
