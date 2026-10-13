import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { E2E_PASSWORD } from "./support/testUsers";

/**
 * Owner request (2026-10-13): "Manage organizations" replaces "Create new
 * organization" in the switcher. The owner renames the organization, buys
 * an environment (a test payment while no payment provider is configured)
 * and disables and enables it. The throwaway account is deleted afterwards
 * and its organizations deprovisioned.
 */

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now().toString(36);
const email = `e2e-manageorg-${stamp}@e2e.wonderagent.test`;
let userId: string | null = null;

test.afterAll(async () => {
  if (!userId) return;
  const { data } = await db().from("tenant_memberships").select("tenant_id").eq("user_id", userId);
  const tenantIds = (data ?? []).map((m) => m.tenant_id as string);
  if (tenantIds.length) await db().from("tenants").update({ status: "deprovisioned" }).in("id", tenantIds);
  await db().auth.admin.deleteUser(userId);
});

test("an owner renames the organization, buys an environment, disables and enables it", async ({ browser }) => {
  const { data, error } = await db().auth.admin.createUser({ email, password: E2E_PASSWORD, email_confirm: true, user_metadata: { full_name: "Manage Org" } });
  expect(error).toBeNull();
  userId = data.user!.id;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: "Switch organization" }).click();
  await expect(page.getByRole("menuitem", { name: "Create new organization" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Manage organizations" }).click();
  await expect(page.getByRole("heading", { name: "Manage organizations" })).toBeVisible();

  // Rename.
  const renamed = `Managed ${stamp}`;
  await page.getByText("Rename", { exact: true }).first().click();
  await page.getByLabel("Organization name").fill(renamed);
  await page.getByRole("button", { name: "Rename" }).click();
  const card = page.getByRole("region", { name: renamed });
  await expect(card).toBeVisible();

  // Buy a test environment.
  await card.getByText("Add environment", { exact: true }).click();
  await card.getByText("Test", { exact: true }).click();
  await expect(card.getByText("Test payment: no money is charged")).toBeVisible();
  await card.getByRole("button", { name: "Pay and set up" }).click();
  await expect(card.getByRole("status").filter({ hasText: "Ready at" })).toBeVisible({ timeout: 20_000 });
  const envRow = card.getByRole("listitem").filter({ hasText: "-test." });
  await expect(envRow).toBeVisible();
  const order = await db().from("environment_orders").select("status, payment_mode, environment").eq("created_by", userId);
  expect(order.data).toEqual([{ status: "fulfilled", payment_mode: "test", environment: "test" }]);

  // Disable it (confirm), then enable it.
  await envRow.getByRole("button", { name: "Disable…" }).click();
  await envRow.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(envRow.getByRole("button", { name: "Enable" })).toBeVisible();
  await expect(envRow.getByText("Disabled", { exact: true })).toBeVisible();
  await envRow.getByRole("button", { name: "Enable" }).click();
  await expect(envRow.getByRole("button", { name: "Disable…" })).toBeVisible();

  await ctx.close();
});
