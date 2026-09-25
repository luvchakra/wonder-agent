import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * EXPERIENCE-P0-18 — the WonderID shell (2026-09-26): a dark navy sidebar
 * from `lg` up, a bottom tab bar plus drawer below it, and one header
 * carrying search / notifications / help / account. The sidebar's sections
 * are an accordion (the current one opens by itself) with groups nested
 * inline; collapsed, it becomes an icon rail whose sections open flyouts,
 * a group opening as a third-level flyout. The current page carries
 * aria-current="page".
 */
test.describe("customer shell", () => {
  test.use({ storageState: authFile("adminOne") });

  test("desktop shows the sidebar, and it marks the current page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("button", { name: "AI Agents" }).click();
    await nav.getByRole("button", { name: "Agent Inventory" }).click();
    await nav.getByRole("link", { name: "All Agents" }).click();
    await expect(page).toHaveURL("/agents");
    await expect(nav.getByRole("button", { name: "AI Agents" })).toHaveAttribute("data-active", "true");
    await expect(nav.getByRole("link", { name: "All Agents" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  test("the current section opens by itself, and the others stay closed", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings/roles");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("button", { name: "Permissions (WonderID)" })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "WonderID Roles" })).toHaveAttribute("aria-current", "page");
    // Another section's pages stay collapsed.
    await expect(nav.getByRole("link", { name: "Sync Jobs" })).toHaveCount(0);
  });

  test("a page inside a group opens that group, and only its page is current", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/agents/discovery");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("button", { name: "Agent Discovery" })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "Discovery Inbox" })).toHaveAttribute("aria-current", "page");
    // The inventory group stays closed; its pages are not current.
    await expect(nav.getByRole("button", { name: "Agent Inventory" })).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("link", { name: "All Agents" })).toHaveCount(0);
  });

  test("collapsed, a section opens a flyout and a group a third-level flyout, and the choice is remembered", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: "AI Agents" }).click();
    await page.getByRole("menuitem", { name: "Agent Discovery" }).hover();
    await page.getByRole("menuitem", { name: "Duplicate Review" }).click();
    await expect(page).toHaveURL("/agents/duplicates");

    await page.reload();
    await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Expand navigation" }).click();
    await expect(nav.getByRole("link", { name: "Duplicate Review" })).toHaveAttribute("aria-current", "page");
  });

  test("the search field opens with its advertised shortcut", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Search" })).toBeVisible();
  });

  test("mobile hides the sidebar, shows the tab bar, and More opens the full nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    await tabs.getByRole("button", { name: "More" }).click();
    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await drawer.getByRole("button", { name: "Insights" }).click();
    await expect(drawer.getByRole("link", { name: "Audit Trail" })).toBeVisible();

    await drawer.getByRole("link", { name: "Audit Trail" }).click();
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
