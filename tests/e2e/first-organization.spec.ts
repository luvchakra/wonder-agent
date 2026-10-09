import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authFile, E2E_PASSWORD } from "./support/testUsers";

/**
 * Sign-up lands in the product: a brand-new account gets its first
 * organization automatically (migration 0107, /onboarding/start) instead of
 * the "Create a new organization" form, is its Tenant Administrator, and
 * renames it in Administration. Going back through /onboarding/start never
 * creates a second one. (Invited people and platform administrators still
 * reach /onboarding — users.spec and auth.setup cover those.)
 *
 * The throwaway account is deleted afterwards and its organization
 * deprovisioned (audit rows are append-only, so the tenant row stays).
 */

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now().toString(36);
const email = `e2e-firstorg-${stamp}@e2e.wonderagent.test`;
let userId: string | null = null;

test.afterAll(async () => {
  if (!userId) return;
  const { data } = await db().from("tenant_memberships").select("tenant_id").eq("user_id", userId);
  const tenantIds = (data ?? []).map((m) => m.tenant_id as string);
  if (tenantIds.length) await db().from("tenants").update({ status: "deprovisioned" }).in("id", tenantIds);
  await db().auth.admin.deleteUser(userId);
});

test("a new account lands in its own organization, once, and can rename it", async ({ browser }) => {
  const { data, error } = await db().auth.admin.createUser({ email, password: E2E_PASSWORD, email_confirm: true, user_metadata: { full_name: "First Org" } });
  expect(error).toBeNull();
  userId = data.user!.id;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Straight into the product — no "Create a new organization" step.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Create a new organization" })).toHaveCount(0);
  const switcher = page.getByRole("button", { name: "Switch organization" });
  await expect(switcher).toContainText("Wonderagent"); // named from the company domain

  // Coming back through the start route creates nothing more.
  await page.goto("/onboarding/start");
  await expect(page).toHaveURL(/\/$/);
  const memberships = await db().from("tenant_memberships").select("tenant_id, status").eq("user_id", userId);
  expect(memberships.data).toHaveLength(1);
  expect(memberships.data![0].status).toBe("active");
  const roles = await db().from("user_roles").select("roles(name)").eq("user_id", userId).returns<{ roles: { name: string } | null }[]>();
  expect(roles.data?.map((r) => r.roles?.name)).toContain("TENANT_SUPER_ADMIN");

  // Rename it in Administration.
  const renamed = `First Org ${stamp}`;
  await page.goto("/settings");
  await page.getByLabel("Organization name").fill(renamed);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch organization" })).toContainText(renamed);
  const audit = await db().from("audit_logs").select("action").eq("tenant_id", memberships.data![0].tenant_id).in("action", ["tenant.created", "tenant.renamed"]);
  expect(audit.data?.map((a) => a.action).sort()).toEqual(["tenant.created", "tenant.renamed"]);

  // A name that is too short once trimmed is refused by the server (the
  // browser's own minLength check passes "  a"), and nothing changes.
  await page.getByLabel("Organization name").fill("  a");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at least 2 characters" })).toBeVisible();
  await ctx.close();
});

test("a read-only member sees the organization name but cannot rename it", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile("readOnly") });
  const page = await ctx.newPage();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Organization" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save name" })).toHaveCount(0);
  await ctx.close();
});
