import { test, expect, type Page } from "@playwright/test";
import { getSeededUserId } from "./support/seedTestData";
import { TEST_USERS, authFile } from "./support/testUsers";

/**
 * IDENTITY-P0-13 — ownership and contract completeness, against the real
 * app and database:
 * - a delegated owner needs an expiry, and is shown with it
 * - the ownership review is refused while a required owner is missing,
 *   and says why; once both are assigned it is confirmed and recorded
 * - a contract carries approved users, delegators, allowed environments
 *   and an expiry; an agent whose environment the contract does not allow
 *   cannot be approved, and says why
 * - only an active member of the organization can be an owner
 * - another organization cannot assign owners to or review this agent
 */

let agentId = "";
let userId = "";

const owners = (page: Page) => page.locator("#owners").locator("..");

async function assignOwner(page: Page, ownerType: string, expires?: string) {
  await page.getByLabel("Owner type").selectOption(ownerType);
  await page.getByLabel("User ID").fill(userId);
  if (expires) await page.getByLabel("Delegation ends (delegated owner only)").fill(expires);
  await page.getByRole("button", { name: "Assign owner", exact: true }).click();
}

test.describe.serial("ownership and contract completeness", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: a production agent", async ({ page }) => {
    userId = await getSeededUserId(TEST_USERS.adminOne.email);
    await page.goto("/agents/new");
    await page.getByLabel("Agent name").fill(`E2E Ownership Agent ${Date.now()}`);
    await page.getByLabel("Agent type").fill("automation");
    await page.getByLabel("Purpose").fill("E2E ownership and contract completeness");
    await page.getByLabel("Environment").selectOption("production");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
    agentId = page.url().split("/agents/")[1];
  });

  test("a delegated owner needs an expiry, and the API refuses one without", async ({ page }) => {
    const refused = await page.request.post(`/api/v1/agents/${agentId}/owners`, { data: { ownerType: "delegated_owner", userId } });
    expect(refused.status()).toBe(400);
    // Someone outside this organization cannot be made an owner.
    const outsider = await getSeededUserId(TEST_USERS.adminTwo.email);
    const notMember = await page.request.post(`/api/v1/agents/${agentId}/owners`, { data: { ownerType: "business_owner", userId: outsider } });
    expect(notMember.status()).toBe(400);

    await page.goto(`/agents/${agentId}`);
    const inSixtyDays = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await assignOwner(page, "delegated_owner", inSixtyDays);
    await expect(owners(page).getByRole("listitem").filter({ hasText: "Delegated owner" })).toContainText(`Delegated until ${inSixtyDays}`);
  });

  test("the ownership review is refused while a required owner is missing, then confirmed", async ({ page }) => {
    await page.goto(`/agents/${agentId}`);
    await page.getByRole("button", { name: "Confirm ownership" }).click();
    await expect(page.getByRole("status").filter({ hasText: /business owner and technical owner/ })).toBeVisible();

    await assignOwner(page, "business_owner");
    await expect(owners(page).getByRole("listitem").filter({ hasText: "Business owner" })).toBeVisible();
    await assignOwner(page, "technical_owner");
    await expect(owners(page).getByRole("listitem").filter({ hasText: "Technical owner" })).toBeVisible();

    await page.getByRole("button", { name: "Confirm ownership" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Ownership confirmed for 3 owners." })).toBeVisible();
    const today = new Date().toISOString().slice(0, 10);
    await expect(owners(page).getByRole("listitem").filter({ hasText: "Business owner" })).toContainText(`Confirmed ${today}`);
  });

  test("a contract that does not allow the agent's environment blocks approval, and says why", async ({ page }) => {
    await page.goto(`/agents/${agentId}`);
    await page.locator("summary", { hasText: "Publish new contract version" }).click();
    await page.getByLabel("Purpose *").fill("E2E contract completeness");
    await page.getByLabel("Approved users (comma-separated)").fill("finance-analysts");
    await page.getByLabel("Approved delegators (comma-separated)").fill("OrchestratorBot");
    await page.getByLabel("Staging").check();
    const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByLabel("Contract expires on").fill(expires);
    await page.getByRole("button", { name: "Publish new contract version" }).click();

    await expect(page.getByText("finance-analysts / OrchestratorBot")).toBeVisible();
    await expect(page.locator("dt", { hasText: "Contract expires" }).locator("..")).toContainText(expires);
    await expect(page.locator("dt", { hasText: "Allowed environments" }).locator("..")).toContainText("staging");

    const res = await page.request.post(`/api/v1/agents/${agentId}/lifecycle`, { data: { toState: "REGISTERED", reason: "e2e" } });
    expect(res.status()).toBe(200);
    const approve = await page.request.post(`/api/v1/agents/${agentId}/lifecycle`, { data: { toState: "APPROVED", reason: "e2e" } });
    expect(approve.status()).toBe(412);
    expect((await approve.json()).error.message).toContain("does not allow the production environment");
  });

  test("another organization cannot assign owners to or review this agent", async ({ browser }) => {
    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    const page = await other.newPage();
    const review = await page.request.post(`/api/v1/agents/${agentId}/owners/review`);
    expect(review.ok()).toBe(false);
    const assign = await page.request.post(`/api/v1/agents/${agentId}/owners`, { data: { ownerType: "business_owner", userId } });
    expect(assign.ok()).toBe(false);
    await other.close();
  });
});
