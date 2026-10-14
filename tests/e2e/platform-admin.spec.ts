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

/**
 * WID-H10, owner decision 2026-10-14: a PLATFORM_ADMIN_EMAILS address only
 * bootstraps the platform_admins table. Runs when the server under test
 * lists the IAM admin's address in PLATFORM_ADMIN_EMAILS (set the same
 * value for Playwright); nothing is granted, so the run leaves no access.
 */
test.describe("PLATFORM_ADMIN_EMAILS bootstrap (WID-H10)", () => {
  test.skip(!(process.env.PLATFORM_ADMIN_EMAILS ?? "").toLowerCase().includes(TEST_USERS.iamAdminOne.email.toLowerCase()), "PLATFORM_ADMIN_EMAILS does not list the IAM admin");
  test.use({ storageState: authFile("iamAdminOne") });

  test("opens only Platform Admins, with its own id filled in; every other console page and API is closed", async ({ page }) => {
    await page.goto("/platform-admin");
    await expect(page).toHaveURL(/\/platform-admin\/admins$/);
    await expect(page.getByRole("heading", { name: "Platform Admins" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Platform" });
    await expect(nav.getByRole("link")).toHaveText(["Platform Admins"]);
    await expect(page.getByText("can only add administrators here")).toBeVisible();
    await expect(page.getByLabel("User id")).not.toHaveValue("");
    for (const path of ["/platform-admin/tenants", "/platform-admin/billing", "/platform-admin/features"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/platform-admin\/admins$/);
    }
    expect((await page.request.get("/api/platform/v1/tenants")).status()).toBe(403);
    expect((await page.request.get("/api/platform/v1/admins")).status()).toBe(403);
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
    await envs
      .getByRole("row")
      .filter({ hasText: `${TENANT_ONE.slug}-dev.` })
      .getByRole("link", { name: "Manage" })
      .click();
    await expect(page.getByRole("heading", { name: `${TENANT_ONE.name} · Development` })).toBeVisible();
    // It says it is an environment, and what is in it.
    await expect(page.getByText("Environment", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "In this environment" }).getByText("Users")).toBeVisible();
    await page.getByRole("link", { name: `← ${TENANT_ONE.name}` }).click();
    // Remove it: decommissioned, address freed, gone from the organization.
    await envs
      .getByRole("row")
      .filter({ hasText: `${TENANT_ONE.slug}-dev.` })
      .getByText("Remove…")
      .click();
    await page.getByRole("button", { name: "Remove Development" }).click();
    await expect(page.getByRole("heading", { name: TENANT_ONE.name, exact: true })).toBeVisible();
    await expect(envs.getByText(`${TENANT_ONE.slug}-dev.`)).toHaveCount(0);
  });

  test("owner request 2026-10-13: the organization's details are saved; its own environment is managed on its own page", async ({ page }) => {
    await page.goto("/platform-admin/tenants");
    await page.getByText(/^Test organizations/).click();
    await page.getByRole("link", { name: TENANT_ONE.name, exact: true }).click();
    await page.locator("#p-contactEmail").fill("contact@localhost");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "contact email" })).toBeVisible();
    await page.locator("#p-contactName").fill("E2E Contact");
    await page.locator("#p-contactEmail").fill("contact@e2e.wonderagent.test");
    await page.locator("#p-userBaseSize").selectOption("51-200");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Details saved." })).toBeVisible();
    await page.reload();
    await expect(page.locator("#p-contactName")).toHaveValue("E2E Contact");
    // Settings live on the environment's own page, not on the organization's.
    await expect(page.getByLabel("Address prefix")).toHaveCount(0);
    const own = page
      .getByRole("region", { name: "Environments" })
      .getByRole("row")
      .filter({ hasText: `${TENANT_ONE.slug}.` });
    await own.getByRole("link", { name: "Manage" }).click();
    await expect(page.getByLabel("Address prefix")).toHaveValue(TENANT_ONE.slug);
    await expect(page.getByRole("heading", { name: "Features" })).toBeVisible();
  });

  test("owner request 2026-10-13: a notice can be ended by hand", async ({ page }) => {
    const title = `E2E notice ${Date.now().toString(36)}`;
    await page.goto("/platform-admin/announcements");
    // Scoped to the test organization, so no real customer sees it.
    await page.locator("#scope").selectOption("tenant");
    await page.locator("#tenantId").selectOption({ label: TENANT_ONE.name });
    await page.locator("#title").fill(title);
    await page.locator("#body").fill("Shown to E2E Tenant One only.");
    await page.getByRole("button", { name: "Publish" }).click();
    const row = page.getByRole("row").filter({ hasText: title });
    await row.getByRole("button", { name: `End ${title} now` }).click();
    await expect(row.getByText("Ended", { exact: true })).toBeVisible();
  });

  for (const path of ["/platform-admin/features", "/platform-admin/branding", "/platform-admin/announcements", "/platform-admin/health", "/platform-admin/admins"]) {
    test(`${path} loads without the app's error boundary`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.ok(), `${path} returned ${response?.status()}`).toBe(true);
      await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
    });
  }
});
