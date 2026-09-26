import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authFile, E2E_PASSWORD, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getSeededUserId } from "./support/seedTestData";

/**
 * FOUNDATION-P0-23 — users and the membership lifecycle against the real
 * app and database:
 * - the Users list (search, status filter) and the Add user wizard; adding
 *   someone now lands on their page with their roles and the permissions
 *   those roles give, with provenance, and says truthfully that no email
 *   was sent;
 * - suspension ends that person's sessions at once (their next request is
 *   refused), is recorded with its reason in their access history, and
 *   reactivation restores access;
 * - an invited person signs in, sees the invitation, accepts it, and lands
 *   in the organization;
 * - nobody changes their own membership or grants themselves a role; the
 *   last Tenant Administrator cannot lose the role;
 * - read-only members cannot see the screens or the API; another
 *   organization's administrator gets 404 for our people.
 * Throwaway people are created here and deleted afterwards.
 */

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now().toString(36);
const added = { name: `Lifecycle Added ${stamp}`, email: `e2e-lifecycle-add-${stamp}@e2e.wonderagent.test` };
const invited = { name: `Lifecycle Invited ${stamp}`, email: `e2e-lifecycle-inv-${stamp}@e2e.wonderagent.test` };
const created: string[] = [];

async function userIdOf(email: string): Promise<string> {
  const { data } = await db().from("users").select("id").eq("email", email).maybeSingle();
  return data!.id as string;
}

/** Give a throwaway person a password (as they would set one), then sign them in. */
async function signInAs(browser: Browser, email: string): Promise<Page> {
  const id = await userIdOf(email);
  const { error } = await db().auth.admin.updateUserById(id, { password: E2E_PASSWORD });
  expect(error).toBeNull();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  return page;
}

async function addThroughWizard(page: Page, person: { name: string; email: string }, method: "invite" | "add", roleLabel: string) {
  await page.goto("/settings/users/new");
  await page.getByLabel("Full name").fill(person.name);
  await page.getByLabel("Email address").fill(person.email);
  await page.getByLabel("Job title").fill("Analyst");
  await page.getByLabel("Department").fill("Risk & Compliance");
  await page.getByRole("radio", { name: method === "invite" ? "Send an invitation" : "Add to the organization now" }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("checkbox", { name: roleLabel }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("region", { name: "Review" })).toContainText(person.email);
  await page.getByRole("button", { name: method === "invite" ? "Send invitation" : "Add user" }).click();
  await expect(page).toHaveURL(/\/settings\/users\/[0-9a-f-]{36}\?created=/, { timeout: 30_000 });
  created.push(await userIdOf(person.email));
}

test.describe("users and the membership lifecycle", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.afterAll(async () => {
    for (const id of created) await db().auth.admin.deleteUser(id);
  });

  test.describe("as the Tenant Administrator", () => {
    test.use({ storageState: authFile("adminOne") });

    test("the Users list finds people by name or email and by status", async ({ page }) => {
      await page.goto("/settings/users");
      await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
      await page.getByRole("search", { name: "Filter users" }).getByLabel("Search").fill(TEST_USERS.readOnly.email);
      await page.getByRole("button", { name: "Filter" }).click();
      await expect(page.getByRole("link", { name: new RegExp(TEST_USERS.readOnly.email) })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(TEST_USERS.adminOne.email) })).toHaveCount(0);
      await page.goto("/settings/users?status=removed&q=no-such-person-anywhere");
      await expect(page.getByText("No users match")).toBeVisible();
    });

    test("adding someone now shows their roles and effective permissions with provenance", async ({ page }) => {
      await addThroughWizard(page, added, "add", "Read Only");
      const created = page.getByRole("status").filter({ hasText: `${added.name} was added.` });
      await expect(created).toContainText("No email was sent");
      await expect(page.getByText("Active").first()).toBeVisible();
      await expect(page.getByRole("cell", { name: /Read Only/ }).first()).toBeVisible();
      await page.getByRole("link", { name: "Effective permissions" }).click();
      const row = page.getByRole("row", { name: /agent\.read/ });
      await expect(row).toContainText("Read Only");
      // Job title and department reached their identity.
      await expect(page.getByText("Analyst")).toBeVisible();
    });
  });

  test("suspension ends their sessions at once; reactivation restores access; history keeps the reason", async ({ browser }) => {
    const person = await signInAs(browser, added.email);
    await expect(person).toHaveURL(/\/$/);
    expect((await person.request.get("/api/v1/agents")).status()).toBe(200);

    const adminCtx = await browser.newContext({ storageState: authFile("adminOne") });
    const admin = await adminCtx.newPage();
    const id = await userIdOf(added.email);
    await admin.goto(`/settings/users/${id}`);
    await admin.getByRole("button", { name: "Suspend" }).click();
    await admin.getByLabel("Reason").fill("E2E: laptop reported lost");
    await admin.getByRole("button", { name: "Suspend" }).click();
    await expect(admin.getByRole("status").filter({ hasText: "Suspended." })).toContainText(/session(s)? ended|no active sessions/);
    await expect(admin.getByText("Suspended", { exact: true }).first()).toBeVisible();

    // Their very next request is refused.
    expect([401, 403]).toContain((await person.request.get("/api/v1/agents")).status());

    await admin.getByRole("link", { name: "Access history" }).click();
    await expect(admin.getByText("E2E: laptop reported lost")).toBeVisible();

    await admin.goto(`/settings/users/${id}`);
    await admin.getByRole("button", { name: "Reactivate" }).click();
    await admin.getByRole("button", { name: "Reactivate" }).click();
    await expect(admin.getByRole("status").filter({ hasText: "Reactivated." })).toBeVisible();
    await person.context().close();
    const again = await signInAs(browser, added.email);
    await expect(again).toHaveURL(/\/$/);
    expect((await again.request.get("/api/v1/agents")).status()).toBe(200);
    await again.context().close();
    await adminCtx.close();
  });

  test("an invited person accepts the invitation and lands in the organization", async ({ browser }) => {
    const adminCtx = await browser.newContext({ storageState: authFile("adminOne") });
    const admin = await adminCtx.newPage();
    await addThroughWizard(admin, invited, "invite", "Read Only");
    await expect(admin.getByRole("status").filter({ hasText: `${invited.name} was invited.` })).toBeVisible();
    await expect(admin.getByText("Invited").first()).toBeVisible();
    await adminCtx.close();

    const person = await signInAs(browser, invited.email);
    await expect(person).toHaveURL(/\/onboarding/);
    const invitation = person.locator("form").filter({ hasText: TENANT_ONE.name });
    await invitation.getByRole("button", { name: "Accept" }).click();
    await expect(person).toHaveURL(/\/$/);
    await expect(person.getByRole("button", { name: "Switch organization" })).toContainText(TENANT_ONE.name);
    await person.context().close();
  });

  test.describe("self-protection and the last administrator", () => {
    test.use({ storageState: authFile("adminOne") });

    test("nobody changes their own membership or grants themselves a role", async ({ page }) => {
      const me = await getSeededUserId(TEST_USERS.adminOne.email);
      await page.goto(`/settings/users/${me}`);
      await expect(page.getByText("Another administrator manages your own membership and roles.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Suspend" })).toHaveCount(0);
      const suspend = await page.request.post(`/api/v1/users/${me}/status`, { data: { action: "suspend", reason: "trying" } });
      expect(suspend.status()).toBe(403);
      expect((await suspend.json()).error.code).toBe("SELF_STATUS_CHANGE");
      const grant = await page.request.post(`/api/v1/users/${me}/roles`, { data: { role: "AUDITOR" } });
      expect(grant.status()).toBe(403);
      expect((await grant.json()).error.code).toBe("SELF_ESCALATION");
    });

    test("the last Tenant Administrator keeps the role", async ({ page }) => {
      const s = db();
      const { data: tenant } = await s.from("tenants").select("id").eq("slug", TENANT_ONE.slug).single();
      const { data: admins } = await s.from("user_roles").select("user_id, roles!inner(name)").eq("tenant_id", tenant!.id).eq("roles.name", "TENANT_SUPER_ADMIN");
      test.skip((admins ?? []).length !== 1, "Tenant One has more than one Tenant Administrator in this database");
      const me = await getSeededUserId(TEST_USERS.adminOne.email);
      const res = await page.request.delete(`/api/v1/users/${me}/roles?role=TENANT_SUPER_ADMIN`);
      expect(res.status()).toBe(409);
      expect((await res.json()).error.code).toBe("LAST_TENANT_ADMIN");
      const { count } = await s.from("user_roles").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenant!.id).eq("user_id", me);
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe("who may see people", () => {
    test("a read-only member sees neither the screens nor the API", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: authFile("readOnly") });
      const page = await ctx.newPage();
      await page.goto("/settings/users");
      await expect(page).toHaveURL(/\/settings$/);
      const id = await getSeededUserId(TEST_USERS.adminOne.email);
      expect((await page.request.get(`/api/v1/users/${id}`)).status()).toBe(403);
      expect((await page.request.post(`/api/v1/users/${id}/status`, { data: { action: "suspend", reason: "x" } })).status()).toBe(403);
      await ctx.close();
    });

    test("another organization's administrator gets 404 for our people", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: authFile("adminTwo") });
      const page = await ctx.newPage();
      const id = await getSeededUserId(TEST_USERS.readOnly.email);
      expect((await page.request.get(`/api/v1/users/${id}`)).status()).toBe(404);
      expect((await page.request.post(`/api/v1/users/${id}/status`, { data: { action: "suspend", reason: "cross-tenant" } })).status()).toBe(404);
      expect((await page.request.get(`/api/v1/users/${id}/sessions`)).status()).toBe(404);
      await page.goto(`/settings/users/${id}`);
      await expect(page.getByText(/not found|could not be found|404/i).first()).toBeVisible();
      await ctx.close();
    });
  });
});
