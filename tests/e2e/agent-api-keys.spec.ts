import { test, expect, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * FOUNDATION-P0-17 / P0-18 — per-agent API keys for the Runtime Gateway.
 * Proves, against the real running app and database:
 * - A new key is shown exactly once. It is gone after a reload, and only
 *   its prefix is listed.
 * - Revocation takes effect and is visible.
 * - RBAC: a read-only user can list but not create (403).
 * - Isolation: another organization's admin can neither list nor create
 *   keys for this organization's agent (404).
 */

async function registerAgent(page: Page, name: string): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(name);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

let agentId = "";

test.describe.serial("agent API keys", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a key is shown once, listed by prefix, and can be revoked", async ({ page }) => {
    agentId = await registerAgent(page, `E2E Key Agent ${Date.now()}`);

    await expect(page.getByRole("heading", { name: "API keys", exact: true })).toBeVisible();
    await page.getByLabel("Key name").fill("e2e gateway");
    await page.getByRole("button", { name: "Create API key" }).click();

    const notice = page.getByRole("status").filter({ hasText: "It will not be shown again" });
    await expect(notice).toBeVisible();
    const secret = (await notice.locator("code").first().textContent())?.trim() ?? "";
    expect(secret).toMatch(/^wa_ak_[A-Za-z0-9_-]{43}$/);

    // After a reload the secret is gone for good; only the prefix is listed.
    await page.reload();
    await expect(page.getByText(secret)).toHaveCount(0);
    await expect(page.getByText(`${secret.slice(0, 12)}…`)).toBeVisible();
    await expect(page.getByText("Active", { exact: true }).last()).toBeVisible();

    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("E2E rotation");
    await dialog.getByRole("button", { name: "Revoke key" }).click();
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  });

  test("the API never returns the secret or its hash from the list", async ({ page }) => {
    const res = await page.request.get(`/api/v1/agents/${agentId}/api-keys`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/wa_ak_[A-Za-z0-9_-]{43}/);
    expect(text).not.toContain("key_hash");
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  test("a read-only user can list keys but cannot create one", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("readOnly") });
    const res = await ctx.request.post(`/api/v1/agents/${agentId}/api-keys`, { data: { name: "nope" } });
    expect(res.status()).toBe(403);
    const list = await ctx.request.get(`/api/v1/agents/${agentId}/api-keys`);
    expect(list.status()).toBe(200);
    await ctx.close();
  });

  test("another organization's admin cannot see or create keys for this agent", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminTwo") });
    const list = await ctx.request.get(`/api/v1/agents/${agentId}/api-keys`);
    expect(list.status()).toBe(200);
    expect((await list.json()).data).toEqual([]);
    const create = await ctx.request.post(`/api/v1/agents/${agentId}/api-keys`, { data: { name: "cross-tenant" } });
    expect(create.status()).toBe(404);
    await ctx.close();
  });
});
