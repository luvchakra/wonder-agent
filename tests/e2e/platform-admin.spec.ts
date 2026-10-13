import { test, expect } from "@playwright/test";
import { authFile, TENANT_ONE, TEST_USERS } from "./support/testUsers";

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

  test("Organizations page lists the seeded E2E organizations", async ({ page }) => {
    await page.goto("/platform-admin/tenants");
    await expect(page.getByRole("heading", { name: "Organizations", exact: true })).toBeVisible();
    // E2E organizations are listed apart from real ones (owner request 2026-10-13).
    await page.getByText(/^Test organizations/).click();
    await expect(page.getByRole("link", { name: TENANT_ONE.name, exact: true })).toBeVisible();
  });

  test("owner request 2026-10-13: an organization shows its owners and holds its environments; one is added, managed and removed", async ({ page }) => {
    await page.goto("/platform-admin/tenants");
    await page.getByText(/^Test organizations/).click();
    await page.getByRole("link", { name: TENANT_ONE.name, exact: true }).click();
    await expect(page.getByRole("heading", { name: TENANT_ONE.name, exact: true })).toBeVisible();
    await expect(page.getByText(TEST_USERS.adminOne.email).first()).toBeVisible();
    const envs = page.getByRole("region", { name: "Environments" });
    await page.getByLabel("Environment to add").selectOption("development");
    await page.getByRole("button", { name: "Add environment" }).click();
    await expect(envs.getByText(`${TENANT_ONE.slug}-dev.`)).toBeVisible();
    // Manage the new environment, then come back to its organization.
    await envs.getByRole("row").filter({ hasText: `${TENANT_ONE.slug}-dev.` }).getByRole("link", { name: "Manage" }).click();
    await expect(page.getByRole("heading", { name: `${TENANT_ONE.name} · Development` })).toBeVisible();
    await page.getByRole("link", { name: `← ${TENANT_ONE.name}` }).click();
    // Remove it: decommissioned, address freed, gone from the organization.
    await envs.getByRole("row").filter({ hasText: `${TENANT_ONE.slug}-dev.` }).getByText("Remove…").click();
    await page.getByRole("button", { name: "Remove Development" }).click();
    await expect(page.getByRole("heading", { name: TENANT_ONE.name, exact: true })).toBeVisible();
    await expect(envs.getByText(`${TENANT_ONE.slug}-dev.`)).toHaveCount(0);
  });

  for (const path of ["/platform-admin/features", "/platform-admin/branding", "/platform-admin/announcements", "/platform-admin/health", "/platform-admin/admins"]) {
    test(`${path} loads without the app's error boundary`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.ok(), `${path} returned ${response?.status()}`).toBe(true);
      await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
    });
  }
});
