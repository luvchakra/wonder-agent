import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { TEST_USERS, TENANT_ONE, TENANT_TWO, type TestUserKey } from "./support/testUsers";

/**
 * FOUNDATION-P0-22 — tenant addresses against the real app and database
 * (TENANT-002 acceptance):
 * - `<slug>.<BASE_APP_HOST>` opens that organization's own sign-in page:
 *   its name, no organization picker, no sign-up;
 * - an address that names no organization, or a reserved one, is a 404;
 * - a member signs in and lands in that organization; the rail shows its
 *   address;
 * - an account that is not a member there is refused, and the session it
 *   just created is ended;
 * - someone in two organizations gets the one the address names;
 * - a suspended organization cannot be signed in to, and says so.
 * The address never authorizes: access still comes from an active
 * membership (non-negotiable #2).
 *
 * The suite's server runs with BASE_APP_HOST=localhost (playwright.config);
 * Chromium resolves *.localhost to this machine. Sessions are per address,
 * so every test signs in on the address it uses.
 */

const BASE = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3100");
const at = (slug: string, path = "/") => `${BASE.protocol}//${slug}.localhost:${BASE.port || (BASE.protocol === "https:" ? 443 : 80)}${path}`;
const SUSPENDED_SLUG = "e2e-suspended-org";

async function signIn(browser: Browser, slug: string, user: TestUserKey): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(at(slug, "/sign-in"));
  await page.getByRole("textbox", { name: "Email" }).fill(TEST_USERS[user].email);
  await page.locator("#password").fill(TEST_USERS[user].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  return page;
}

test.describe("tenant addresses", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeAll(async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    // A suspended organization, for the refusal (its address comes from the tenant trigger).
    const { data: existing } = await db.from("tenants").select("id, status").eq("slug", SUSPENDED_SLUG).maybeSingle();
    if (!existing) {
      const { error } = await db.from("tenants").insert({ name: "E2E Suspended Org", slug: SUSPENDED_SLUG, status: "suspended" });
      expect(error).toBeNull();
    } else if (existing.status !== "suspended") {
      await db.from("tenants").update({ status: "suspended" }).eq("id", existing.id);
    }
  });

  test("an organization's address opens its own sign-in page; unknown and reserved addresses are 404", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(at(TENANT_ONE.slug, "/sign-in"));
    await expect(page.getByTestId("sign-in-tenant")).toContainText(TENANT_ONE.name);
    await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
    await expect(page.getByText(`Not part of ${TENANT_ONE.name}?`)).toBeVisible();

    const missing = await page.goto(at("no-such-organization", "/"));
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "No organization at this address" })).toBeVisible();
    expect((await page.goto(at("www", "/sign-in")))?.status()).toBe(404);
    // The API answers the same way, without naming any organization.
    const api = await page.evaluate(async () => {
      const r = await fetch("/api/v1/agents");
      return { status: r.status, body: await r.json() };
    });
    expect(api).toMatchObject({ status: 404, body: { error: { code: "TENANT_NOT_FOUND" } } });
    await ctx.close();
  });

  test("a member signs in on the address and lands in that organization", async ({ browser }) => {
    const page = await signIn(browser, TENANT_ONE.slug, "adminOne");
    await expect(page).toHaveURL(at(TENANT_ONE.slug, "/"));
    await expect(page.getByRole("button", { name: "Switch organization" })).toContainText(`${TENANT_ONE.slug}.localhost`);
    // Its API serves this organization only.
    const me = await page.evaluate(async () => (await fetch("/api/v1/agents")).status);
    expect(me).toBe(200);
    await page.context().close();
  });

  test("someone who is not a member there is refused, and that new session ends", async ({ browser }) => {
    const page = await signIn(browser, TENANT_ONE.slug, "adminTwo");
    await expect(page.getByText(`This account is not an active member of ${TENANT_ONE.name}.`)).toBeVisible();
    await page.goto(at(TENANT_ONE.slug, "/"));
    await expect(page).toHaveURL(/\/sign-in/);
    await page.context().close();
  });

  test("a member of two organizations gets the one the address names", async ({ browser }) => {
    const page = await signIn(browser, TENANT_TWO.slug, "multiOrg");
    await expect(page).toHaveURL(at(TENANT_TWO.slug, "/"));
    await expect(page.getByRole("button", { name: "Switch organization" })).toContainText(TENANT_TWO.name);
    await page.context().close();
    const one = await signIn(browser, TENANT_ONE.slug, "multiOrg");
    await expect(one).toHaveURL(at(TENANT_ONE.slug, "/"));
    await expect(one.getByRole("button", { name: "Switch organization" })).toContainText(TENANT_ONE.name);
    await one.context().close();
  });

  test("a suspended organization cannot be signed in to, and says so", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(at(SUSPENDED_SLUG, "/sign-in"));
    await expect(page.getByTestId("sign-in-tenant")).toContainText("E2E Suspended Org");
    await expect(page.getByText("E2E Suspended Org is suspended. Sign-in is paused; contact your administrator.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
    await ctx.close();
  });
});
