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

test("the main address is the landing page; signing in there lists the person's organizations, each opening at its own address", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();

  // A product page on the main address, signed out: sign in.
  await page.goto("/identities");
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByRole("textbox", { name: "Email" }).fill(TEST_USERS.adminOne.email);
  await page.locator("#password").fill(TEST_USERS.adminOne.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/organizations$/);
  const link = page.getByRole("link", { name: new RegExp(TENANT_ONE.name) });
  await expect(link).toHaveAttribute("href", at(TENANT_ONE.slug, "/sign-in"));

  // Signed in, the product still does not open on the main address.
  await page.goto("/identities");
  await expect(page).toHaveURL(/\/organizations$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/organizations$/);

  // The API is unaffected on the main address.
  expect((await page.request.get("/api/v1/identities")).status()).toBe(200);

  // The organization's own address opens its sign-in, then the product.
  await link.click();
  await expect(page).toHaveURL(at(TENANT_ONE.slug, "/sign-in"));
  await page.getByRole("textbox", { name: "Email" }).fill(TEST_USERS.adminOne.email);
  await page.locator("#password").fill(TEST_USERS.adminOne.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(at(TENANT_ONE.slug, "/"));
  await expect(page.getByRole("button", { name: "Switch organization" })).toContainText(TENANT_ONE.name);
});
