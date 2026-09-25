import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * IDENTITY-P0-11 / IDENTITY-P0-12 — Shadow AI and the non-human identity
 * inventory, against the real app and database:
 * - an event from an agent nobody registered is refused and quarantined,
 *   never recorded as runtime activity
 * - it appears in the discovery inbox as Shadow AI, for that organization
 *   only
 * - registering it links the reference, so the agent's next event is
 *   recorded, and the Shadow AI entry is gone
 * - the registered identity is in the NHI inventory, linked to the agent
 */

const ref = `e2e-shadow-bot-${Date.now()}`;
let agentId = "";

const sendEvent = (request: APIRequestContext, data: Record<string, unknown>) =>
  request.post("/api/v1/runtime/events", {
    data: { eventTime: new Date().toISOString(), source: "mcp", action: "READ", success: true, application: "Snowflake", tool: "query_customers", ...data },
  });

async function shadowRow(page: Page) {
  await page.goto("/agents/discovery?tab=shadow_ai");
  return page.getByRole("link", { name: ref });
}

test.describe.serial("shadow AI discovery", () => {
  test.use({ storageState: authFile("adminOne") });

  test("an unregistered agent's event is quarantined, not recorded, and validated first", async ({ page }) => {
    const res = await sendEvent(page.request, { agentRef: ref });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe("AGENT_NOT_REGISTERED");

    // Shape: exactly one of agentId / agentRef, and agentId is a UUID.
    expect((await sendEvent(page.request, {})).status()).toBe(400);
    expect((await sendEvent(page.request, { agentId: "not-a-uuid" })).status()).toBe(400);
    expect((await sendEvent(page.request, { agentId: "00000000-0000-4000-8000-000000000000", agentRef: ref })).status()).toBe(400);
  });

  test("it is listed as Shadow AI in its own organization's discovery inbox only", async ({ page, browser }) => {
    await sendEvent(page.request, { agentRef: ref, tool: "export_customers" });
    const row = await shadowRow(page);
    await expect(row).toBeVisible();

    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    const otherPage = await other.newPage();
    await otherPage.goto("/agents/discovery?tab=shadow_ai");
    await expect(otherPage.getByRole("heading", { name: "Agent Discovery" })).toBeVisible();
    await expect(otherPage.getByText(ref)).toHaveCount(0);
    await other.close();

    await row.click();
    await expect(page.getByRole("heading", { name: ref })).toBeVisible();
    await expect(page.getByText("Runtime activity from an unregistered agent")).toBeVisible();
    await expect(page.getByText(/2 events via mcp/)).toBeVisible();
  });

  test("registering it links the reference: its next event is recorded and it leaves the inbox", async ({ page }) => {
    await (await shadowRow(page)).click();
    await page.getByLabel("Agent type").fill("automation");
    await page.getByLabel("Purpose").fill("E2E shadow AI registration");
    await page.getByRole("button", { name: "Register Agent" }).click();
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
    agentId = page.url().split("/agents/")[1];

    const res = await sendEvent(page.request, { agentRef: ref });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.agentId).toBe(agentId);

    await page.goto("/agents/discovery?tab=shadow_ai");
    await expect(page.getByRole("link", { name: ref })).toHaveCount(0);
  });

  test("the NHI inventory lists it as linked to the new agent, for this organization only", async ({ page, browser }) => {
    await page.goto("/agents/identities?tab=linked");
    await expect(page.getByRole("heading", { name: "Non-human identities" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: ref });
    await expect(row.getByText("Linked", { exact: true })).toBeVisible();
    await expect(row.getByRole("link", { name: ref }).first()).toHaveAttribute("href", `/agents/${agentId}`);

    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    const otherPage = await other.newPage();
    await otherPage.goto("/agents/identities");
    await expect(otherPage.getByRole("heading", { name: "Non-human identities" })).toBeVisible();
    await expect(otherPage.getByText(ref)).toHaveCount(0);
    await other.close();
  });
});
