import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * EXPERIENCE-P0-18 — the WonderID shell (2026-09-26): a sidebar (light since
 * EXPERIENCE-P0-23)
 * from `lg` up, a bottom tab bar plus drawer below it, and one header
 * carrying search / notifications / help / account. The sidebar is an area
 * list (owner decision, 2026-10-10): an area opens its own menu in place of
 * the list, with a back arrow, its pages as rows and its groups folding
 * open; the menu follows the page, and a menu search sits above it.
 * Collapsed, it becomes an icon rail whose areas open flyouts, a group
 * opening as a second flyout. The current page carries aria-current="page".
 * "Admin" is the last area and holds the organization's administration.
 */
test.describe("customer shell", () => {
  test.use({ storageState: authFile("adminOne") });

  test("desktop shows the area list, and an area opens its own menu, which marks the current page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    // The area list: Home first, Admin last, each area a row.
    const areas = nav.locator(":scope ul > li");
    await expect(areas.first()).toContainText("Home");
    await expect(areas.last()).toContainText("Admin");
    await expect(nav.getByRole("button", { name: "Home" })).toHaveAttribute("data-active", "true");

    // Opening an area shows its menu in the sidebar, without leaving the page.
    await nav.getByRole("button", { name: "AI Agents" }).click();
    await expect(page).toHaveURL("/");
    await expect(nav.getByRole("heading", { name: "AI Agents" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Home" })).toHaveCount(0);
    await nav.getByRole("button", { name: "Agent Inventory" }).click();
    await nav.getByRole("link", { name: "All Agents" }).click();
    await expect(page).toHaveURL("/agents");
    await expect(nav.getByRole("link", { name: "All Agents" })).toHaveAttribute("aria-current", "page");

    // The back arrow returns to the area list, where the page's area is current.
    await nav.getByRole("button", { name: "All areas" }).click();
    await expect(nav.getByRole("button", { name: "AI Agents" })).toHaveAttribute("data-active", "true");
    await expect(nav.getByRole("button", { name: "Home" })).not.toHaveAttribute("data-active");
  });

  test("Admin is the last area and holds the organization's administration, in groups", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    // Administration lives only inside Admin.
    await expect(nav.getByRole("button", { name: "Integrations" })).toHaveCount(0);
    await nav.getByRole("button", { name: "Admin" }).click();
    await expect(nav.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Integrations" })).toBeVisible();
    await nav.getByRole("button", { name: "Integrations" }).click();
    await nav.getByRole("link", { name: "Sync Jobs" }).click();
    await expect(page).toHaveURL("/integrations/jobs");
    await expect(nav.getByRole("link", { name: "Sync Jobs" })).toHaveAttribute("aria-current", "page");
  });

  test("the menu search finds pages across every area, and only the menu", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("searchbox", { name: "Search menu" }).fill("sync");
    const results = nav.getByRole("list", { name: "Matching pages" });
    await expect(results.getByRole("link", { name: /Sync Jobs/ })).toContainText("Admin › Integrations");
    await expect(nav.getByRole("button", { name: "Home" })).toHaveCount(0);
    await nav.getByRole("searchbox", { name: "Search menu" }).fill("zzzz");
    await expect(nav.getByRole("status")).toHaveText("No menu item matches.");
    await nav.getByRole("searchbox", { name: "Search menu" }).fill("");
    await expect(nav.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("the footer names the version", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator("aside").getByText(/^WonderID v\d+\.\d+\.\d+/)).toBeVisible();
  });

  test("an admin page opens the Admin menu with its group open, and nothing else", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings/roles");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Users & Permissions" })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "WonderID Roles" })).toHaveAttribute("aria-current", "page");
    // Another group's pages stay folded.
    await expect(nav.getByRole("link", { name: "Sync Jobs" })).toHaveCount(0);
  });

  test("a member's own page under /settings stays in Home, not Admin", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings/security");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sign-in Security" })).toHaveAttribute("aria-current", "page");
  });

  test("a page inside a group opens that group, and only its page is current", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/agents/discovery");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("heading", { name: "AI Agents" })).toBeVisible();
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
    await expect(drawer.getByRole("heading", { name: "Insights" })).toBeVisible();
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
