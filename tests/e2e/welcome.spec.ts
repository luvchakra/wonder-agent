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
    await expect(page.getByRole("heading", { name: /Govern every identity/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Close the gap by holding all three answers/i })).toBeVisible();
  });

  test("both calls to action reach the real auth screens", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Get started", exact: true }).first().click();
    await expect(page).toHaveURL(/\/sign-up/);
    await expect(page.getByRole("heading", { name: "Create your WonderID account" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: "Sign in to WonderID" })).toBeVisible();
  });

  test("pricing shows the billing catalogue's plans, by period and currency", async ({ page }) => {
    await page.goto("/#pricing");
    const pricing = page.locator("#pricing");
    await expect(pricing.getByRole("heading", { name: "Start free. Pay as you grow." })).toBeVisible();
    for (const plan of ["Free", "Pro", "Max", "Enterprise"]) await expect(pricing.getByRole("heading", { name: plan, exact: true })).toBeVisible();
    // Paid prices come from billing_prices, never a hard-coded figure: a monthly price in USD…
    const pro = pricing.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) });
    await expect(pro.getByText(/^\$[\d,]+$/)).toBeVisible();
    await expect(pro.getByText("/ month")).toBeVisible();
    // …a yearly one with its monthly equivalent, and the same plan in rupees with GST included.
    await pricing.getByRole("button", { name: "Yearly" }).click();
    await expect(pro.getByText("/ year")).toBeVisible();
    await expect(pro.getByText(/billed yearly/)).toBeVisible();
    await pricing.getByLabel("Currency").selectOption("INR");
    await expect(pro.getByText(/^₹[\d,]+$/)).toBeVisible();
    await expect(pro.getByText(/incl\. GST/)).toBeVisible();
    // Limits match the plan definitions, and the CTAs go where they say.
    await expect(pricing.getByText("3 users")).toBeVisible();
    await expect(pricing.getByRole("link", { name: "Talk to us" })).toHaveAttribute("href", /^mailto:/);
    await expect(pricing.getByRole("link", { name: "Start with Pro" })).toHaveAttribute("href", "/sign-up");
  });

  test("non-human identities and the identity and administration screens are shown", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Most identities in your estate aren.t people/ })).toBeVisible();
    for (const name of ["Every identity, one directory", "People and their roles", "Roles you can reason about", "Policies that override any role"]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await expect(page.getByRole("img", { name: /Identities overview for Northwind Financial/ }).first()).toBeAttached();
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
    await expect(page.getByRole("heading", { name: "AI Agent Security Overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Govern every identity/i })).toHaveCount(0);
  });

  test("/welcome redirects a signed-in user into the app", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "AI Agent Security Overview" })).toBeVisible();
  });
});
