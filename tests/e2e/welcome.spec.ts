import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * EXPERIENCE-P0-14 — the public landing page, and the routing that lets it
 * and the authenticated Overview share "/" (a rewrite in proxy.ts rather
 * than two route groups both declaring a root page.tsx).
 */
test.describe("landing page (signed out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('"/" serves the landing page, not a redirect to sign-in', async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: /Govern every AI agent/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Close the gap by holding all three answers/i })).toBeVisible();
  });

  test("both calls to action reach the real auth screens", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Get started", exact: true }).first().click();
    await expect(page).toHaveURL(/\/sign-up/);
    await expect(page.getByRole("heading", { name: "Create your WonderAgent account" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: "Sign in to WonderAgent" })).toBeVisible();
  });

  test("renders without horizontal overflow at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "landing page overflows horizontally at 390px").toBeLessThanOrEqual(1);
  });
});

test.describe("landing page (signed in)", () => {
  test.use({ storageState: authFile("adminOne") });

  test('"/" still serves the authenticated Overview', async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Govern every AI agent/i })).toHaveCount(0);
  });

  test("/welcome redirects a signed-in user into the app", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });
});
