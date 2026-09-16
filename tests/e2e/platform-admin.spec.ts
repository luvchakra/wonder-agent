import { test, expect } from "@playwright/test";
import { authFile, TENANT_ONE } from "./support/testUsers";

test.describe("Platform-admin authorization boundary (non-negotiable #3)", () => {
  test("an ordinary tenant user gets a plain 404 for /platform-admin, never the admin nav", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await context.newPage();
    const response = await page.goto("/platform-admin");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Platform Overview")).not.toBeVisible();
    await context.close();
  });

  test("a TENANT_SUPER_ADMIN (the most powerful customer role) still gets 404 for platform-admin sub-routes", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await context.newPage();
    const response = await page.goto("/platform-admin/tenants");
    expect(response?.status()).toBe(404);
    await context.close();
  });
});

test.describe("Platform-admin console", () => {
  test.use({ storageState: authFile("platformAdmin") });

  test("Platform Overview loads for a seeded platform admin", async ({ page }) => {
    await page.goto("/platform-admin");
    await expect(page.getByRole("heading", { name: "Platform Overview" })).toBeVisible();
  });

  test("Tenants page lists the seeded E2E tenants", async ({ page }) => {
    await page.goto("/platform-admin/tenants");
    await expect(page.getByRole("heading", { name: "Tenants", exact: true })).toBeVisible();
    await expect(page.getByText(TENANT_ONE.name)).toBeVisible();
  });

  for (const path of ["/platform-admin/features", "/platform-admin/branding", "/platform-admin/announcements", "/platform-admin/health", "/platform-admin/admins"]) {
    test(`${path} loads without the app's error boundary`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.ok(), `${path} returned ${response?.status()}`).toBe(true);
      await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
    });
  }
});
