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
      const label = ownerType === "business_owner" ? "Business owner" : "Technical owner";
      await expect(page.locator("#owners").locator("..").getByRole("listitem").filter({ hasText: label })).toBeVisible();
    }

    await page.locator('select[name="toState"]').selectOption("REGISTERED");
    await page.locator('input[name="reason"]').fill("E2E lifecycle transition coverage");
    await page.getByRole("button", { name: "Transition", exact: true }).click();

    // Scoped: "REGISTERED" also appears as an <option> in the transition
    // select and in the lifecycle-history line, so an unscoped text match
    // trips strict mode. The status badge is the thing under test.
    await expect(page.getByText("REGISTERED", { exact: false }).first()).toBeVisible();
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

/**
 * EXPERIENCE-P0-15 — the agents list and agent detail, rebuilt to the
 * supplied design: segment tabs above the list (underline tabs since the
 * 2026-09-25 light-console redesign, still a radio group), and an identity
 * header with a governance-posture panel on the detail page.
 */
test.describe("agents — design rebuild", () => {
  test.use({ storageState: authFile("adminOne") });

  test("the segment tabs filter the list", async ({ page }) => {
    await page.goto("/agents");
    const pills = page.getByRole("radiogroup", { name: "Filter agents" });
    await expect(pills.getByRole("radio", { name: /^All/ })).toHaveAttribute("aria-checked", "true");

    await pills.getByRole("radio", { name: /^Unowned/ }).click();
    await expect(pills.getByRole("radio", { name: /^Unowned/ })).toHaveAttribute("aria-checked", "true");
    await expect(pills.getByRole("radio", { name: /^All/ })).toHaveAttribute("aria-checked", "false");
  });

  test("agent detail shows the governance posture panel, and no raw JSON", async ({ page }) => {
    await page.goto("/agents");
    await page.getByRole("link", { name: /^E2E Agent/ }).first().click();
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);

    await expect(page.getByRole("heading", { name: "Agent information" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Governance posture" })).toBeVisible();

    // Ownership issues used to render as JSON.stringify output on a badge.
    await expect(page.getByText('{"type":"missing_owner"')).toHaveCount(0);
  });
});
