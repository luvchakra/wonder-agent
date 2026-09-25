import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * EXPERIENCE-P0-15 — the customer shell: a permanent navigation rail from
 * `lg` up, a bottom tab bar plus drawer below it, and one header carrying
 * search / notifications / help / account. Rebuilt 2026-09-25 to the
 * light-console mockups: the rail is grouped into sections, and the current
 * section lists its sub-pages beneath it (the section link carries
 * aria-current="true", the sub-page aria-current="page").
 */
test.describe("customer shell", () => {
  test.use({ storageState: authFile("adminOne") });

  test("desktop shows the rail, and the rail marks the current page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Agents", exact: true }).click();
    await expect(page).toHaveURL("/agents");
    await expect(nav.getByRole("link", { name: "Agents", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(nav.getByRole("link", { name: "All Agents" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  test("the current section lists its sub-pages, and only it does", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings/roles");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Administration" })).toHaveAttribute("aria-current", "true");
    await expect(nav.getByRole("link", { name: "Roles & Permissions" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Organization" })).not.toHaveAttribute("aria-current");
    // Another section's sub-pages stay collapsed.
    await expect(nav.getByRole("link", { name: "Sync Jobs" })).toHaveCount(0);
  });

  test("a more specific route does not also light up its parent", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/agents/discovery");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Discover", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(nav.getByRole("link", { name: "Agent Discovery" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Agents", exact: true })).not.toHaveAttribute("aria-current");
  });

  test("the search field opens with its advertised shortcut", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Search" })).toBeVisible();
  });

  test("mobile hides the rail, shows the tab bar, and More opens the full nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    await tabs.getByRole("button", { name: "More" }).click();
    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await expect(drawer.getByRole("link", { name: "Audit & Compliance" })).toBeVisible();

    await drawer.getByRole("link", { name: "Audit & Compliance" }).click();
    await expect(page).toHaveURL("/audit");
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeHidden();
  });

  test("renders without horizontal overflow at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "shell overflows horizontally at 390px").toBeLessThanOrEqual(1);
  });
});
