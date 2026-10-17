import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * Admin › Global Configuration (owner request, 2026-10-10): the settings
 * that change how WonderID behaves for one organization, versioned and
 * restorable. This spec changes only the dormant-account threshold and
 * puts it back, so it never shortens another spec's session.
 */
test.describe.serial("global configuration", () => {
  test.use({ storageState: authFile("adminOne") });

  test("an administrator changes the dormant threshold and the Accounts page follows it; restoring puts it back", async ({ page }) => {
    await page.goto("/settings/configuration");
    await expect(page.getByRole("heading", { level: 1, name: "Global Configuration" })).toBeVisible();
    for (const section of ["Sign-in and sessions", "Access", "AI agents and runtime", "Risk", "Certifications", "Separation of duties"]) {
      await expect(page.getByText(section, { exact: true }).first()).toBeVisible();
    }

    const dormant = page.getByLabel("Dormant account after");
    const before = await dormant.inputValue();
    const target = before === "30" ? "60" : "30";
    await dormant.selectOption(target);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText(/Saved as version \d+\. 1 setting changed\./);

    await page.goto("/access/accounts");
    await expect(page.getByText(`has not been used in ${target} days`)).toBeVisible();

    // The history lists the change; restoring the version before it puts the old value back.
    await page.goto("/settings/configuration");
    await page.getByText("Change history").click();
    const history = page.locator("details ol > li");
    await expect(history.first()).toContainText(`Dormant account after: ${before} → ${target}`);
    await page.getByLabel("Dormant account after").selectOption(before);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText(/Saved as version \d+\./);
    await page.goto("/access/accounts");
    await expect(page.getByText(`has not been used in ${before} days`)).toBeVisible();
  });

  test("nothing is saved when nothing changed", async ({ page }) => {
    await page.goto("/settings/configuration");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Nothing changed.");
  });
  // PLATFORM-P0-13: the settings as a signed file, previewed before they are imported (after the tests above restore the settings).
  test("an export previews as no change here, and an edited file is refused", async ({ page }) => {
    const res = await page.request.get("/api/v1/tenant/configuration/bundle");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const bundle = await res.json();
    expect(bundle.format).toBe("wonderid-config-bundle");
    expect(bundle.signature).toMatch(/^[0-9a-f]{64}$/);

    await page.goto("/settings/configuration");
    const box = page.getByTestId("config-bundle");
    await box.locator("summary").click();
    const upload = async (body: unknown) => {
      await box.getByLabel("Configuration file").setInputFiles({ name: "configuration.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(body)) });
      await box.getByRole("button", { name: "Preview" }).click();
    };
    await upload(bundle);
    await expect(box.getByText("This organization already has these settings.")).toBeVisible();

    const dormant = bundle.settings["access.dormantDays"] === 30 ? 60 : 30;
    await upload({ ...bundle, settings: { ...bundle.settings, "access.dormantDays": dormant } });
    await expect(box.getByText(/changed after it was exported/)).toBeVisible();
  });
});

test.describe("global configuration — who sees it", () => {
  test.use({ storageState: authFile("readOnly") });

  test("a read-only member has no Global Configuration in the menu and is sent back from the page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("searchbox", { name: "Search menu" }).fill("global");
    await expect(nav.getByRole("status")).toHaveText("No menu item matches.");
    // Opening it directly sends them back to Administration, as other admin pages do.
    await page.goto("/settings/configuration");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Global Configuration" })).toHaveCount(0);
  });
});
