import { test, expect, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, E2E_PASSWORD, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * FOUNDATION-P0-32 — bulk invitation and the invitation API.
 * - A 50-row CSV, imported from the Users page through the connector
 *   framework: the preview shows new, already-member and invalid rows;
 *   Confirm invites exactly the new ones; the same file again invites no one.
 * - POST /api/v1/users/invitations: dry run, then send; idempotent on e-mail.
 * - Roles given by invitation stay within the inviter's own permissions.
 * - An expired invitation cannot be accepted; sending it again renews it.
 */

const stamp = Date.now();
const mail = (who: string) => `e2e-bulk-${who}-${stamp}@e2e.wonderagent.test`;
const created: string[] = [];
let tenantId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function invitedIds(prefix: string): Promise<string[]> {
  const { data } = await db().from("users").select("id").like("email", `e2e-bulk-${prefix}%-${stamp}@e2e.wonderagent.test`);
  return (data ?? []).map((r) => r.id as string);
}

async function signInAs(browser: Browser, email: string) {
  const { data } = await db().from("users").select("id").eq("email", email).single();
  expect((await db().auth.admin.updateUserById(data!.id as string, { password: E2E_PASSWORD })).error).toBeNull();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  return page;
}

test.describe.serial("bulk invitation", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async () => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
  });

  test.afterAll(async () => {
    for (const id of [...new Set([...created, ...(await invitedIds(""))])]) await db().auth.admin.deleteUser(id);
  });

  test("a 50-row CSV: the preview shows new, already-member and invalid rows; Confirm invites exactly the new ones, once", async ({ page }) => {
    // 42 invitations run one after another, about 3 s each against the dev
    // project from a remote runner (~260 ms per round trip; 2026-10-12).
    test.setTimeout(360_000);
    const members = [TEST_USERS.readOnly, TEST_USERS.requester, TEST_USERS.iamAdminOne, TEST_USERS.multiOrg, TEST_USERS.signOutOnly].map((u) => `${u.email},Already Here,`);
    const invalid = ["not-an-email,Bad Address,", `${mail("noname")},,`, `${mail("badrole")},Bad Role,NO_SUCH_ROLE`];
    const fresh = Array.from({ length: 42 }, (_, i) => `${mail(`csv${i}`)},Bulk Person ${i},READ_ONLY`);
    const csv = ["email,displayName,roles", ...fresh, ...members, ...invalid].join("\n");
    expect(fresh.length + members.length + invalid.length).toBe(50);

    await page.goto("/settings/users");
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Import CSV…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/CSV file/).setInputFiles({ name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await dialog.getByRole("button", { name: "Preview" }).click();
    const table = dialog.getByRole("table");
    await expect(table).toContainText("Bulk Person 0");
    await expect(table).toContainText("Already in this organization");
    await expect(table).toContainText("Unknown role: NO_SUCH_ROLE");
    await dialog.getByRole("button", { name: /Confirm import \(42\)/ }).click();
    await expect(dialog.getByRole("status")).toContainText("42 added", { timeout: 240_000 });
    await dialog.getByRole("button", { name: "Close" }).click();

    // Exactly those invitations, each with the role it asked for, and nobody else.
    const ids = await invitedIds("csv");
    expect(ids).toHaveLength(42);
    const { data: memberships } = await db().from("tenant_memberships").select("status").eq("tenant_id", tenantId).in("user_id", ids);
    expect((memberships ?? []).every((m) => m.status === "invited")).toBe(true);
    expect(await invitedIds("noname")).toHaveLength(0);
    expect(await invitedIds("badrole")).toHaveLength(0);

    // The same file again: nothing new.
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Import CSV…" }).click();
    await dialog.getByLabel(/CSV file/).setInputFiles({ name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await dialog.getByRole("button", { name: "Preview" }).click();
    await expect(table).toContainText("Already in this organization");
    await expect(dialog.getByRole("button", { name: "Nothing to import" })).toBeDisabled();
  });

  test("the invitation API: a dry run sends nothing; sending is idempotent on e-mail", async ({ request }) => {
    const invitations = [
      { email: mail("api1"), displayName: "Api One" },
      { email: mail("api2"), displayName: "Api Two", roles: ["READ_ONLY"] },
      { email: TEST_USERS.requester.email, displayName: "Requester" },
      { email: "nope", displayName: "Nope" },
    ];
    const dry = await request.post("/api/v1/users/invitations", { data: { invitations, dryRun: true } });
    expect(dry.status(), await dry.text()).toBe(200);
    expect((await dry.json()).data.counts).toEqual({ new: 2, unchanged: 1, invalid: 1 });
    expect(await invitedIds("api")).toHaveLength(0);

    const sent = await request.post("/api/v1/users/invitations", { data: { invitations } });
    expect(sent.status(), await sent.text()).toBe(201);
    expect((await sent.json()).data.counts).toEqual({ invited: 2, unchanged: 1, skipped: 1, failed: 0 });
    const again = await request.post("/api/v1/users/invitations", { data: { invitations } });
    expect((await again.json()).data.counts).toEqual({ invited: 0, unchanged: 3, skipped: 1, failed: 0 });
    expect(await invitedIds("api")).toHaveLength(2);
  });

  test("roles given by invitation stay within the inviter's own permissions", async ({ browser, request }) => {
    // An inviter who may invite and assign roles, but holds only a few permissions.
    const roleName = `E2E Inviter ${stamp}`;
    const role = await request.post("/api/v1/roles", { data: { name: roleName, description: "Invites people", permissions: ["users.view", "users.invite", "roles.assign"] } });
    expect(role.status(), await role.text()).toBe(201);
    const viewer = `E2E Viewer ${stamp}`;
    expect((await request.post("/api/v1/roles", { data: { name: viewer, description: "Sees users", permissions: ["users.view"] } })).status()).toBe(201);
    const { data: requester } = await db().from("users").select("id").eq("email", TEST_USERS.requester.email).single();
    expect((await request.post(`/api/v1/users/${requester!.id}/roles`, { data: { role: roleName } })).status()).toBe(200);

    const inviter = await browser.newContext({ storageState: authFile("requester") });
    try {
      const escalate = await inviter.request.post("/api/v1/users/invitations", { data: { invitations: [{ email: mail("esc"), displayName: "Escalation", roles: ["TENANT_SUPER_ADMIN"] }] } });
      const escalated = (await escalate.json()).data;
      expect(escalated.counts.invited).toBe(0);
      expect(escalated.rows[0].message).toMatch(/Not held/);
      const within = await inviter.request.post("/api/v1/users/invitations", { data: { invitations: [{ email: mail("within"), displayName: "Within Scope", roles: [viewer] }] } });
      expect((await within.json()).data.counts.invited).toBe(1);
      expect(await invitedIds("esc")).toHaveLength(0);
    } finally {
      await inviter.close();
      await db().from("user_roles").delete().eq("tenant_id", tenantId).eq("user_id", requester!.id).in("role_id", (await db().from("roles").select("id").eq("tenant_id", tenantId).in("name", [roleName, viewer])).data!.map((r) => r.id));
    }
  });

  test("an expired invitation cannot be accepted; sending it again renews it", async ({ browser, page, request }) => {
    const email = mail("late");
    expect((await request.post("/api/v1/users/invitations", { data: { invitations: [{ email, displayName: "Late Joiner" }] } })).status()).toBe(201);
    const { data: person } = await db().from("users").select("id").eq("email", email).single();
    await db().from("tenant_memberships").update({ invited_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }).eq("tenant_id", tenantId).eq("user_id", person!.id);

    const invitee = await signInAs(browser, email);
    await expect(invitee).toHaveURL(/\/onboarding/);
    const row = invitee.locator("form").filter({ hasText: TENANT_ONE.name });
    await expect(row).toContainText("Expired");
    await expect(row.getByRole("button", { name: "Accept" })).toHaveCount(0);

    // The administrator sees it expired and sends it again; now it can be accepted.
    await page.goto(`/settings/users/${person!.id}`);
    await expect(page.getByText("The invitation has expired.")).toBeVisible();
    await page.getByRole("button", { name: "Send invitation again" }).click();
    await expect(page.getByRole("status").filter({ hasText: /valid from today|Renewed from today/ })).toBeVisible();
    await invitee.reload();
    await invitee.locator("form").filter({ hasText: TENANT_ONE.name }).getByRole("button", { name: "Accept" }).click();
    await expect(invitee).toHaveURL(/\/$/);
    await invitee.context().close();
  });
});
