import { test, expect } from "@playwright/test";
import { getSeededUserId } from "./support/seedTestData";
import { TEST_USERS, authFile } from "./support/testUsers";

test.describe("Identity module — agents", () => {
  test.use({ storageState: authFile("adminOne") });

  test("list page shows the register-agent entry point", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "AI Agents" })).toBeVisible();
    await expect(page.getByRole("link", { name: "+ Register agent" })).toBeVisible();
  });

  test("registering an agent redirects to its detail page and shows the entered fields", async ({ page }) => {
    const agentName = `E2E Agent ${Date.now()}`;
    await page.goto("/agents/new");
    await page.getByLabel("Agent name").fill(agentName);
    await page.getByLabel("Agent type").fill("automation");
    await page.getByLabel("Purpose").fill("End-to-end registration coverage");
    await page.getByLabel("Criticality").selectOption("high");
    await page.getByRole("button", { name: "Register", exact: true }).click();

    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: agentName })).toBeVisible();
    await expect(page.getByText("automation")).toBeVisible();
  });

  test("a lifecycle transition is recorded on the detail page", async ({ page }) => {
    const agentName = `E2E Lifecycle Agent ${Date.now()}`;
    await page.goto("/agents/new");
    await page.getByLabel("Agent name").fill(agentName);
    await page.getByLabel("Agent type").fill("automation");
    // Purpose is required before any lifecycle transition ("Agent must have
    // a purpose set") — a real governance rule, not an incidental field.
    await page.getByLabel("Purpose").fill("End-to-end lifecycle coverage");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);

    // A lifecycle transition requires an ACTIVE business owner AND technical
    // owner ("Agent requires an active business_owner and technical_owner") —
    // a real governance rule, so the test satisfies it rather than working
    // around it. Both are assigned to the acting admin, whose id is taken
    // from the tenant-members table on the roles screen.
    const userId = await getSeededUserId(TEST_USERS.adminOne.email);
    for (const ownerType of ["business_owner", "technical_owner"]) {
      await page.locator('select[name="ownerType"]').selectOption(ownerType);
      await page.locator('input[name="userId"]').fill(userId);
      await page.getByRole("button", { name: "Assign owner", exact: true }).click();
      await expect(page.getByText(ownerType).first()).toBeVisible();
    }

    await page.locator('select[name="toState"]').selectOption("REGISTERED");
    await page.locator('input[name="reason"]').fill("E2E lifecycle transition coverage");
    await page.getByRole("button", { name: "Transition", exact: true }).click();

    await expect(page.getByText(/REGISTERED/)).toBeVisible();
    await expect(page.getByText("E2E lifecycle transition coverage")).toBeVisible();
  });

  test("the Agent sections nav links to Access/Runtime/Risk for the same agent", async ({ page }) => {
    const agentName = `E2E Nav Agent ${Date.now()}`;
    await page.goto("/agents/new");
    await page.getByLabel("Agent name").fill(agentName);
    await page.getByLabel("Agent type").fill("automation");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page).toHaveURL(/\/agents\/([0-9a-f-]{36})/);
    const agentId = page.url().split("/agents/")[1];

    const nav = page.getByRole("navigation", { name: "Agent sections" });
    await nav.getByRole("link", { name: "Access (CAN)" }).click();
    await expect(page).toHaveURL(`/access/agents/${agentId}`);

    await page.goto(`/agents/${agentId}`);
    await page.getByRole("navigation", { name: "Agent sections" }).getByRole("link", { name: "Runtime (DID)" }).click();
    await expect(page).toHaveURL(`/runtime/agents/${agentId}`);

    await page.goto(`/agents/${agentId}`);
    await page.getByRole("navigation", { name: "Agent sections" }).getByRole("link", { name: "Risk & Findings" }).click();
    await expect(page).toHaveURL(`/risk/agents/${agentId}`);
  });

  test("discovery inbox and duplicate-review pages are reachable from the list page", async ({ page }) => {
    await page.goto("/agents");
    await page.getByRole("link", { name: "Discovery inbox" }).click();
    await expect(page).toHaveURL(/\/agents\/discovery/);

    await page.goto("/agents");
    await page.getByRole("link", { name: "Duplicate review" }).click();
    await expect(page).toHaveURL(/\/agents\/duplicates/);
  });
});
