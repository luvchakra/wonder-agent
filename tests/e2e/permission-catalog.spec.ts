import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * FOUNDATION-P0-24 — the permission catalog against the real app and
 * database: every permission is listed under its product module with its
 * resource and action, sensitivity and the system roles that grant it;
 * it can be searched and filtered; people who hold permissions.view see
 * it (the Identity Administrator included), a read-only member does not.
 */
test.describe("permission catalog", () => {
  test("the Tenant Administrator browses the catalog by module, sensitivity and search", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await ctx.newPage();
    await page.goto("/settings/permissions");
    await expect(page.getByRole("heading", { name: "Permission catalog", level: 1 })).toBeVisible();
    for (const m of ["Discover", "Understand", "Govern", "Protect", "Assure", "Administration"]) {
      await expect(page.getByRole("heading", { name: m, level: 2 })).toBeVisible();
    }
    // The kill switch is privileged, in Protect, granted to the Security and Tenant Administrators.
    await page.getByRole("search", { name: "Filter permissions" }).getByLabel("Search").fill("emergency");
    await page.getByRole("button", { name: "Filter" }).click();
    const row = page.getByRole("row", { name: /runtime\.emergency/ });
    await expect(row).toContainText("Privileged");
    await expect(page.getByRole("heading", { name: "Protect", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Discover", level: 2 })).toHaveCount(0);

    await page.goto("/settings/permissions?module=ADMINISTRATION&sensitivity=privileged");
    await expect(page.getByRole("row", { name: /users\.remove/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /users\.view/ })).toHaveCount(0);
    await ctx.close();
  });

  test("the Identity Administrator can read it; a read-only member cannot", async ({ browser }) => {
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const iamPage = await iam.newPage();
    await iamPage.goto("/settings/permissions");
    await expect(iamPage.getByRole("heading", { name: "Permission catalog", level: 1 })).toBeVisible();
    await iam.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    const roPage = await ro.newPage();
    await roPage.goto("/settings/permissions");
    await expect(roPage).toHaveURL(/\/settings$/);
    await ro.close();
  });
});
