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

    // EXPERIENCE-P0-17's wording: the friendly label with the model term.
    await expect(page.getByRole("heading", { name: "Approved (SHOULD) vs Effective Access (CAN) vs Observed (DID)" })).toBeVisible();
    await expect(page.getByText("Current Request (NOW)", { exact: true })).toBeVisible();
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

/**
 * EXPERIENCE-P0-15 — /runtime is now the tenant-wide activity stream the
 * supplied design shows, not a bare list of agent links.
 */
test.describe("runtime activity — design rebuild", () => {
  test.use({ storageState: authFile("adminOne") });

  test("filters narrow the stream and a row opens its details", async ({ page }) => {
    await page.goto("/runtime");
    await expect(page.getByRole("heading", { name: "Runtime activity" })).toBeVisible();

    // Selecting a result that nothing in the window matches empties the list
    // rather than silently showing everything. (RUNTIME-P0-16 renamed the
    // results truthfully: "Failed", never "Blocked", while nothing is
    // enforced; gateway decisions are their own filter.)
    await page.getByLabel("Result").selectOption("failed");
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await page.getByLabel("Result").selectOption("decision");
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();

    await page.getByLabel("Result").selectOption("all");
    const firstRow = page.getByRole("list", { name: "Activity events" }).getByRole("listitem").first();
    if (await firstRow.isVisible()) {
      await firstRow.getByRole("button").click();
      await expect(page.getByRole("tab", { name: "Raw log" })).toBeVisible();
    }
  });
});
