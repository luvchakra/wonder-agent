import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { E2E_PASSWORD } from "./support/testUsers";

/**
 * FOUNDATION-P0-27 — an organization requires multi-factor authentication,
 * against the real app, Supabase Auth and database:
 * - an administrator cannot turn it on from a session that has not used MFA
 *   (so they cannot lock themselves out), and can after verifying;
 * - a member who signs in without MFA sees only "Verify it's you": the
 *   product redirects there and the API refuses with MFA_REQUIRED;
 * - setting up an authenticator app there, or using one already set up,
 *   lets the person in.
 * Two throwaway accounts in a throwaway organization (the first one's
 * automatic first organization), so no other spec is affected. Deleted
 * afterwards; the organization is deprovisioned (audit rows stay).
 */

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now().toString(36);
const adminEmail = `e2e-mfa-admin-${stamp}@e2e.wonderagent.test`;
const memberEmail = `e2e-mfa-member-${stamp}@e2e.wonderagent.test`;
const ids = { admin: "", member: "", tenant: "" };

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as authenticator apps compute it. */
function totp(base32: string, at = Date.now()): { code: string; step: number } {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const step = Math.floor(at / 30_000);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return { code: n, step };
}

/** A code from a time step not used before (a code is accepted once). */
const used = new Set<number>();
async function freshCode(secret: string): Promise<string> {
  for (;;) {
    const { code, step } = totp(secret);
    if (!used.has(step)) {
      used.add(step);
      return code;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Sets up an authenticator app on /verify-mfa and verifies it; returns its secret. */
async function setUpAuthenticator(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  return secret;
}

test.describe.serial("an organization that requires MFA", () => {
  test.describe.configure({ timeout: 180_000 });
  let adminSecret = "";

  test.afterAll(async () => {
    if (ids.tenant) await db().from("tenants").update({ status: "deprovisioned" }).eq("id", ids.tenant);
    for (const id of [ids.admin, ids.member]) if (id) await db().auth.admin.deleteUser(id);
  });

  test("an administrator turns it on only after verifying with MFA", async ({ browser }) => {
    const { data, error } = await db().auth.admin.createUser({ email: adminEmail, password: E2E_PASSWORD, email_confirm: true, user_metadata: { full_name: "MFA Admin" } });
    expect(error).toBeNull();
    ids.admin = data.user!.id;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, adminEmail);
    // The automatic first organization (it may still be being created when "/" first loads).
    await expect(page.getByRole("button", { name: "Switch organization" })).toBeVisible();
    await expect.poll(async () => (await db().from("tenant_memberships").select("tenant_id").eq("user_id", ids.admin)).data?.length ?? 0).toBe(1);
    ids.tenant = (await db().from("tenant_memberships").select("tenant_id").eq("user_id", ids.admin).single()).data!.tenant_id as string;

    // Not from a session without MFA: nothing is saved.
    const refused = await page.request.patch("/api/v1/tenant/configuration", { data: { "security.mfaRequired": 1 } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error.fields["security.mfaRequired"]).toContain("authenticator app");

    // Verify this session (voluntarily), then it saves.
    await page.goto("/verify-mfa");
    await expect(page.getByRole("heading", { name: "Verify it's you" })).toBeVisible();
    adminSecret = await setUpAuthenticator(page);
    await expect(page).toHaveURL(/\/$/);
    const saved = await page.request.patch("/api/v1/tenant/configuration", { data: { "security.mfaRequired": 1 } });
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).data.changes).toEqual([{ key: "security.mfaRequired", from: 0, to: 1 }]);
    // The administrator's MFA session keeps working.
    await page.goto("/settings/configuration");
    await expect(page.getByLabel("Multi-factor authentication")).toHaveValue("1");
    await ctx.close();
  });

  test("a member without MFA sees only the MFA step until they set it up", async ({ browser }) => {
    const { data, error } = await db().auth.admin.createUser({ email: memberEmail, password: E2E_PASSWORD, email_confirm: true, user_metadata: { full_name: "MFA Member" } });
    expect(error).toBeNull();
    ids.member = data.user!.id;
    const { data: role } = await db().from("roles").select("id").is("tenant_id", null).eq("name", "READ_ONLY").single();
    expect((await db().from("tenant_memberships").insert({ tenant_id: ids.tenant, user_id: ids.member, status: "active" })).error).toBeNull();
    expect((await db().from("user_roles").insert({ tenant_id: ids.tenant, user_id: ids.member, role_id: role!.id })).error).toBeNull();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, memberEmail);
    await expect(page).toHaveURL(/\/verify-mfa$/);
    await expect(page.getByText("requires multi-factor authentication")).toBeVisible();
    // Any product page leads back here, and the API refuses.
    await page.goto("/identities");
    await expect(page).toHaveURL(/\/verify-mfa$/);
    const api = await page.request.get("/api/v1/identities");
    expect(api.status()).toBe(403);
    expect((await api.json()).error.code).toBe("MFA_REQUIRED");
    // A wrong code is refused and keeps them here.
    await page.getByRole("button", { name: "Set up an authenticator app" }).click();
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible();
    // The right one lets them in.
    const secret = (await page.locator("code").first().textContent())!.trim();
    await page.getByLabel("6-digit code").fill(await freshCode(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await page.request.get("/api/v1/identities")).status()).toBe(200);
    await ctx.close();
  });

  test("signing in again asks for the authenticator app already set up", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, adminEmail);
    await expect(page).toHaveURL(/\/verify-mfa$/);
    await expect(page.getByRole("button", { name: "Set up an authenticator app" })).toHaveCount(0);
    await page.getByLabel("6-digit code").fill(await freshCode(adminSecret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/$/);
    // Turning it off needs one person, from any session that may change it.
    const off = await page.request.patch("/api/v1/tenant/configuration", { data: { "security.mfaRequired": 0 } });
    expect(off.status(), await off.text()).toBe(200);
    await ctx.close();
  });
});
