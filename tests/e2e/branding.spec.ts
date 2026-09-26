import { test, expect, type Page } from "@playwright/test";
import { authFile, TENANT_ONE } from "./support/testUsers";

/**
 * EXPERIENCE-P0-22/23 — WonderID branding (BRAND-001..006, BRAND-012
 * baseline) against the running app:
 * - the brand artwork is served to a visitor with no session (the sign-in
 *   page shows it before anyone signs in) and actually renders;
 * - the favicon is the W mark; tab titles follow "WonderID · <page>", or
 *   "<Organization> · <page> · WonderID" inside the product and on an
 *   organization's own address;
 * - the shell carries the logo, the collapsed rail keeps the W mark, and
 *   below `lg` the header carries it;
 * - Electric Blue is the primary colour in light mode;
 * - the sign-in screen matches its reviewed baseline, desktop and mobile.
 */

async function logoRendered(page: Page, selector: string) {
  const img = page.locator(selector).first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}

test.describe("branding — signed out", () => {
  test("brand assets are public and the sign-in page is branded", async ({ page, request }) => {
    for (const p of ["/brand/logo/wonderid-logo.svg", "/brand/logo/wonderid-mark.svg", "/brand/favicon/favicon.svg"]) {
      const r = await request.get(p, { maxRedirects: 0 });
      expect(r.status(), p).toBe(200);
      expect(r.headers()["content-type"], p).toContain("image/svg+xml");
    }
    await page.goto("/sign-in");
    await expect(page).toHaveTitle("WonderID · Sign in");
    await expect(page.getByRole("heading", { name: "Sign in to WonderID" })).toBeVisible();
    await expect(page.getByText("Secure access for every identity.")).toBeVisible();
    await logoRendered(page, 'a[aria-label="WonderID"] img[src*="/brand/logo/wonderid-logo-tagline"]');
    await expect(page.locator('link[rel="icon"][href*="/brand/favicon/favicon.svg"]')).toHaveCount(1);
  });

  test("an organization's address names it in the title and the page", async ({ page }) => {
    const base = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3100");
    await page.goto(`${base.protocol}//${TENANT_ONE.slug}.localhost:${base.port}/sign-in`);
    await expect(page).toHaveTitle(`${TENANT_ONE.name} · Sign in · WonderID`);
    await expect(page.getByRole("heading", { name: "Sign in to your organization" })).toBeVisible();
    await expect(page.getByTestId("sign-in-tenant")).toContainText("Secure access powered by WonderID");
  });

  test("the sign-in screen matches its baseline (desktop and mobile, light)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    for (const [name, width, height] of [
      ["sign-in-desktop.png", 1280, 800],
      ["sign-in-mobile.png", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/sign-in");
      await logoRendered(page, 'a[aria-label="WonderID"] img');
      await expect(page).toHaveScreenshot(name, { fullPage: true, maxDiffPixelRatio: 0.01 });
    }
  });
});

test.describe("branding — in the product", () => {
  test.use({ storageState: authFile("adminOne") });

  test("titles name the organization; the rail carries the logo, collapsed the W mark", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page).toHaveTitle(`${TENANT_ONE.name} · WonderID`);
    const nav = page.locator("aside");
    await logoRendered(page, 'aside a img[alt="WonderID"][src*="/brand/logo/wonderid-logo-dark"]');
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const expand = nav.getByRole("button", { name: "Expand navigation" });
    await expect(expand.locator('img[src*="/brand/logo/wonderid-mark"]')).toBeVisible();
    await expand.click();
    await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeVisible();

    // Electric Blue drives the primary colour (light theme).
    await page.emulateMedia({ colorScheme: "light" });
    const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
    expect(primary).toBe("oklch(0.498 0.282 267.2)");
  });

  test("below lg the header carries the W mark", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const home = page.getByRole("link", { name: "WonderID home" });
    await expect(home).toBeVisible();
    await logoRendered(page, 'a[aria-label="WonderID home"] img');
  });
});
