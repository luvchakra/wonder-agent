import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * EXPERIENCE-P0-18 — the WonderID shell (2026-09-26): a sidebar (light since
 * EXPERIENCE-P0-23)
 * from `lg` up, a bottom tab bar plus drawer below it, and one header
 * carrying search / notifications / help / account. The sidebar is an area
 * list (owner decision, 2026-10-13, the owner's navigation sheet): Home, My
 * Workspace, Access, AI Agents, Access Reviews, Risk & Detection, Self
 * Service and Administration. An area opens
 * its own menu in place of the list, with a back arrow, its pages as rows
 * and its groups folding open; the menu follows the page, and a menu
 * search sits above it. A hamburger-style toggle at the top right
 * collapses it to an icon rail (toggle, search icon, area icons) whose
 * areas open flyouts, a group opening as a second flyout. The current page
 * carries aria-current="page". "Administration" is the last area.
 */
test.describe("customer shell", () => {
  test.use({ storageState: authFile("adminOne") });

  test("desktop shows the area list, and an area opens its own menu, which marks the current page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    // The area list: Home first, Administration last, each area a row.
    const areas = nav.locator(":scope ul > li");
    await expect(areas.first()).toContainText("Home");
    await expect(areas.last()).toContainText("Administration");
    await expect(nav.getByRole("button", { name: "Home" })).toHaveAttribute("data-active", "true");

    // Opening an area shows its menu in the sidebar, without leaving the page.
    await nav.getByRole("button", { name: "AI Agents" }).click();
    await expect(page).toHaveURL("/");
    await expect(nav.getByRole("heading", { name: "AI Agents" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Home" })).toHaveCount(0);
    await nav.getByRole("link", { name: "Agent Inventory" }).click();
    await expect(page).toHaveURL("/agents");
    await expect(nav.getByRole("link", { name: "Agent Inventory" })).toHaveAttribute("aria-current", "page");

    // The back arrow returns to the area list, where the page's area is current.
    await nav.getByRole("button", { name: "All areas" }).click();
    await expect(nav.getByRole("button", { name: "AI Agents" })).toHaveAttribute("data-active", "true");
    await expect(nav.getByRole("button", { name: "Home" })).not.toHaveAttribute("data-active");
  });

  test("Administration is the last area and holds the organization's administration, in menus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    // Administration lives only inside Admin.
    await expect(nav.getByRole("button", { name: "Integrations" })).toHaveCount(0);
    await nav.getByRole("button", { name: "Administration" }).click();
    await expect(nav.getByRole("heading", { name: "Administration" })).toBeVisible();
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
    await expect(results.getByRole("link", { name: /Sync Jobs/ })).toContainText("Administration › Integrations");
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

  test("an admin page opens the Administration menu with its group open, and nothing else", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings/users");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("heading", { name: "Administration" })).toBeVisible();
    // The Admin sidebar's menus; the page's own one is open.
    for (const name of ["Identities", "Applications", "Policies & Controls", "Reports & Audit", "Integrations", "Organization Settings", "Privacy & Audit"]) await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Users & Roles" })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "Roles", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Users", exact: true })).toHaveAttribute("aria-current", "page");
    // Another group's pages stay folded.
    await expect(nav.getByRole("link", { name: "Sync Jobs" })).toHaveCount(0);
  });

  test("a member's own page under /settings stays in My Workspace, not Administration", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings/security");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("heading", { name: "My Workspace" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sign-in Security" })).toHaveAttribute("aria-current", "page");
  });

  test("a page inside a group opens that group, and only its page is current", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/identities/humans");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Identities" })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "Workforce" })).toHaveAttribute("aria-current", "page");
    // The Applications group stays closed; its pages are not current.
    await expect(nav.getByRole("button", { name: "Applications" })).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("link", { name: "Application Catalog" })).toHaveCount(0);
  });

  test("two views of one page are separate menu items: My Requests and Approvals", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/access/requests?view=waiting");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("heading", { name: "My Workspace" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Approvals" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "My Requests" }).click();
    await expect(page).toHaveURL("/access/requests?view=mine");
    await expect(nav.getByRole("link", { name: "My Requests" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Approvals" })).not.toHaveAttribute("aria-current");
  });

  test("collapsed, a section opens a flyout and a group a third-level flyout, and the choice is remembered", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: "Administration" }).click();
    await page.getByRole("menuitem", { name: "Identities" }).hover();
    await page.getByRole("menuitem", { name: "Workforce" }).click();
    await expect(page).toHaveURL("/identities/humans");

    await page.reload();
    await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Expand navigation" }).click();
    await expect(nav.getByRole("link", { name: "Workforce" })).toHaveAttribute("aria-current", "page");
  });

  test("collapsed, the rail's search icon opens the sidebar straight into its search", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: "Search menu" }).click();
    const box = nav.getByRole("searchbox", { name: "Search menu" });
    await expect(box).toBeFocused();
    await box.fill("violations");
    await nav.getByRole("link", { name: /SoD Violations/ }).click();
    await expect(page).toHaveURL("/sod/conflicts");
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
    await drawer.getByRole("button", { name: "Risk & Detection" }).click();
    await expect(drawer.getByRole("heading", { name: "Risk & Detection" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Rogue Accounts" })).toBeVisible();

    await drawer.getByRole("link", { name: "Rogue Accounts" }).click();
    await expect(page).toHaveURL("/risk/rogue-accounts");
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
