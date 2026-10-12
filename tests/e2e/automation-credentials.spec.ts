import { test, expect, request as playwrightRequest, type Browser, type APIRequestContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, E2E_PASSWORD, TEST_USERS, TENANT_ONE, TENANT_TWO } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * FOUNDATION-P0-31 — automation credentials for the administration API.
 * - Created on Admin › Automation credentials; the secret is shown once.
 * - Pending until a second administrator approves it (four-eyes): the
 *   creator cannot, by the console or the API.
 * - Bearer calls to /api/v1/* act with the credential's role only: the
 *   Configuration Administrator lists connections and reads Global
 *   Configuration, but cannot list users (403); nothing of another
 *   organization is reachable; pages are refused (401).
 * - Every call is audited with the owner identity as on-behalf-of.
 * - Rate limit (429), expiry (401) and revocation (401) stop it.
 * - Roles beyond the giver's own permissions are refused.
 */

const stamp = Date.now();
const credentialName = `E2E pipeline ${stamp}`;
const approverRole = `E2E Automation Approver ${stamp}`;
let tenantId = "";
let identityId = "";
let credentialId = "";
let secret = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function bearer(baseURL: string | undefined): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${secret}` } });
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
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  return page;
}

test.describe.serial("automation credentials", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async ({ request }) => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const { data, error } = await db().from("identities").insert({ tenant_id: tenantId, identity_type: "APPLICATION", display_name: `E2E Pipeline App ${stamp}` }).select("id").single();
    expect(error).toBeNull();
    identityId = data!.id as string;
    // A second person who may approve: IAM Administrator plus a role holding automation.manage.
    expect((await request.post("/api/v1/roles", { data: { name: approverRole, description: "Approves automation credentials", permissions: ["automation.manage"] } })).status()).toBe(201);
    const { data: iam } = await db().from("users").select("id").eq("email", TEST_USERS.iamAdminOne.email).single();
    expect((await request.post(`/api/v1/users/${iam!.id}/roles`, { data: { role: approverRole } })).status()).toBe(200);
  });

  test.afterAll(async () => {
    const { data: creds } = await db().from("automation_credentials").select("backing_user_id").eq("tenant_id", tenantId).like("name", `E2E pipeline ${stamp}%`);
    for (const c of creds ?? []) await db().auth.admin.deleteUser(c.backing_user_id as string);
    await db().from("identities").delete().eq("id", identityId);
    const { data: role } = await db().from("roles").select("id").eq("tenant_id", tenantId).eq("name", approverRole).maybeSingle();
    if (role) {
      await db().from("user_roles").delete().eq("role_id", role.id);
      await db().from("roles").delete().eq("id", role.id);
    }
  });

  test("create shows the secret once; it is pending and the creator cannot approve it", async ({ page, baseURL }) => {
    await page.goto("/settings/automation");
    await page.getByLabel("Name").fill(credentialName);
    await page.getByLabel("Application identity").selectOption({ label: `E2E Pipeline App ${stamp}` });
    await expect(page.getByLabel("Role")).toHaveValue("CONFIGURATION_ADMIN");
    await page.getByRole("button", { name: "Create credential" }).click();
    await expect(page.getByRole("status")).toContainText("another administrator approves it");
    secret = (await page.getByTestId("automation-secret").textContent())!.trim();
    expect(secret).toMatch(/^wa_ac_[A-Za-z0-9_-]{43}$/);

    const { data: row } = await db().from("automation_credentials").select("id, status, key_hash").eq("tenant_id", tenantId).eq("name", credentialName).single();
    credentialId = row!.id as string;
    expect(row!.status).toBe("pending");
    expect(row!.key_hash).not.toContain(secret);

    await page.reload();
    const item = page.getByRole("row", { name: new RegExp(credentialName) });
    await expect(item).toContainText("Awaiting approval");
    await expect(item.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByText(secret)).toHaveCount(0);

    const self = await page.request.post(`/api/v1/automation-credentials/${credentialId}`, { data: { action: "approve" } });
    expect(self.status()).toBe(403);
    expect((await self.json()).error.code).toBe("FOUR_EYES");

    const api = await bearer(baseURL);
    const pending = await api.get("/api/v1/integrations");
    expect(pending.status()).toBe(401);
    expect((await pending.json()).error.code).toBe("CREDENTIAL_PENDING");
    await api.dispose();
  });

  test("a second administrator approves; the credential acts with its role only, in its own organization", async ({ browser, baseURL }) => {
    const approver = await signInAs(browser, TEST_USERS.iamAdminOne.email);
    await approver.goto("/settings/automation");
    const row = approver.getByRole("row", { name: new RegExp(credentialName) });
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row).toContainText("Active");
    await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // Never beyond the giver's own permissions, and never automation.manage.
    const escalate = await approver.request.post(`/api/v1/automation-credentials/${credentialId}`, { data: { action: "assign_role", role: "TENANT_SUPER_ADMIN" } });
    expect(escalate.status()).toBe(403);
    expect((await escalate.json()).error.code).toBe("ROLE_ESCALATION");
    await approver.context().close();

    const api = await bearer(baseURL);
    const list = await api.get("/api/v1/integrations");
    expect(list.status()).toBe(200);
    const ids = ((await list.json()).data as { id: string }[]).map((i) => i.id);
    const { data: own } = await db().from("integrations").select("id").eq("tenant_id", tenantId);
    expect(new Set(ids)).toEqual(new Set((own ?? []).map((i) => i.id as string)));

    // Another organization's connection is not reachable, whatever the request says.
    const otherTenant = await getTenantIdBySlug(TENANT_TWO.slug);
    const { data: theirs } = await db().from("integrations").select("id").eq("tenant_id", otherTenant).limit(1);
    if (theirs?.length) {
      expect((await api.get(`/api/v1/integrations/${theirs[0].id}/schedule`, { headers: { Cookie: `wa_tenant=${otherTenant}` } })).status()).toBe(404);
    }
    const withCookie = await api.get("/api/v1/integrations", { headers: { Cookie: `wa_tenant=${otherTenant}` } });
    expect(new Set(((await withCookie.json()).data as { id: string }[]).map((i) => i.id))).toEqual(new Set(ids));

    const config = await api.get("/api/v1/tenant/configuration");
    expect(config.status(), await config.text()).toBe(200);
    expect((await api.get("/api/v1/users")).status()).toBe(403);
    expect((await api.get("/api/v1/automation-credentials")).status()).toBe(403);
    expect((await api.get("/settings")).status()).toBe(401);
    await api.dispose();

    const { data: audit } = await db()
      .from("audit_logs")
      .select("actor_type, outcome, metadata")
      .eq("tenant_id", tenantId)
      .eq("action", "automation.api_call")
      .eq("object_id", credentialId)
      .order("created_at", { ascending: false })
      .limit(20);
    const calls = (audit ?? []) as { actor_type: string; outcome: string; metadata: { onBehalfOf: string; path: string; method: string } }[];
    expect(calls.some((c) => c.metadata.path === "/api/v1/integrations" && c.metadata.method === "GET")).toBe(true);
    expect(calls.every((c) => c.actor_type === "integration" && c.metadata.onBehalfOf === identityId)).toBe(true);
  });

  test("the backing account is not a person: not in the users directory", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
    await expect(page.getByText(`Automation: ${credentialName}`)).toHaveCount(0);
  });

  test("rate limit, expiry and revocation stop it", async ({ page, baseURL }) => {
    const api = await bearer(baseURL);
    await db().from("automation_credentials").update({ rate_limit_per_minute: 1 }).eq("id", credentialId);
    // The counter may already hold this minute's calls; within two calls the limit applies.
    const statuses = [(await api.get("/api/v1/integrations")).status(), (await api.get("/api/v1/integrations")).status()];
    expect(statuses).toContain(429);
    await db().from("automation_credentials").update({ rate_limit_per_minute: 120 }).eq("id", credentialId);

    const { data: before } = await db().from("automation_credentials").select("expires_at").eq("id", credentialId).single();
    await db().from("automation_credentials").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", credentialId);
    const expired = await api.get("/api/v1/integrations");
    expect(expired.status()).toBe(401);
    expect((await expired.json()).error.code).toBe("CREDENTIAL_EXPIRED");
    await db().from("automation_credentials").update({ expires_at: before!.expires_at }).eq("id", credentialId);
    expect((await api.get("/api/v1/integrations")).status()).toBe(200);

    await page.goto("/settings/automation");
    const item = page.getByRole("row", { name: new RegExp(credentialName) });
    await item.locator("summary", { hasText: "Manage" }).click();
    await item.getByLabel("Reason").fill("E2E: pipeline retired");
    await item.getByRole("button", { name: "Revoke" }).click();
    await expect(item).toContainText("Revoked");

    const revoked = await api.get("/api/v1/integrations");
    expect(revoked.status()).toBe(401);
    expect((await revoked.json()).error.code).toBe("CREDENTIAL_REVOKED");
    await api.dispose();
  });
});
