import { test, expect } from "@playwright/test";
import { TEST_USERS, TENANT_ONE } from "./support/testUsers";

/**
 * Owner request (2026-10-13), with ORG_ADDRESS_REQUIRED=true (production):
 * the main address is the landing page; the product opens only on an
 * organization's own address. Runs only against a server started with the
 * flag (E2E_ORG_ADDRESS_REQUIRED=1), since the rest of the suite uses the
 * main address.
 */
test.skip(process.env.E2E_ORG_ADDRESS_REQUIRED !== "1", "needs a server with ORG_ADDRESS_REQUIRED=true");

const BASE = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3100");
const at = (slug: string, path = "/") => `${BASE.protocol}//${slug}.localhost:${BASE.port}${path}`;

test("the main address is the landing page; signing in there sends the person to their organization's own address", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();

  // A product page on the main address, signed out: sign in.
  await page.goto("/identities");
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByRole("textbox", { name: "Email" }).fill(TEST_USERS.adminOne.email);
  await page.locator("#password").fill(TEST_USERS.adminOne.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Owner request 2026-10-13: no organization list; straight to an organization's own sign-in.
  const orgSignIn = /^http:\/\/[a-z0-9-]+\.localhost:\d+\/sign-in$/;
  await expect(page).toHaveURL(orgSignIn);

  // Signed in on the main address, the product still does not open there.
  await page.goto(`${BASE.origin}/identities`);
  await expect(page).toHaveURL(orgSignIn);
  await page.goto(`${BASE.origin}/`);
  await expect(page).toHaveURL(orgSignIn);

  // The API is unaffected on the main address.
  expect((await page.request.get(`${BASE.origin}/api/v1/identities`)).status()).toBe(200);

  // The organization's own address opens its sign-in, then the product.
  await page.goto(at(TENANT_ONE.slug, "/sign-in"));
  await page.getByRole("textbox", { name: "Email" }).fill(TEST_USERS.adminOne.email);
  await page.locator("#password").fill(TEST_USERS.adminOne.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(at(TENANT_ONE.slug, "/"));
  await expect(page.getByRole("button", { name: "Switch organization" })).toContainText(TENANT_ONE.name);
});
