import { test, expect } from "@playwright/test";
import { authFile, TEST_USERS } from "./support/testUsers";

/**
 * The user guide, FAQ and help assistant at /help.
 *
 * Since 2026-10-16 (owner request) the guide needs a session: signed out,
 * every help route goes to sign-in and comes back after it, and the
 * assistant's API answers 401 with no guide text. The landing page and the
 * sign-in screens link to the contact address instead, and the public pages
 * still load without a session.
 *
 * The assistant is exercised for real against the running app — with no
 * AI provider configured on this deployment it answers from the guide
 * text (the AI path is unit-tested in lib/ai/helpAnswer.test.ts, where the
 * provider can be mocked).
 */
test.describe("help centre (signed out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/help goes to sign-in, and signing in comes back to the guide", async ({ page }) => {
    await page.goto("/help");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fhelp/);
    await page.getByLabel("Email").fill(TEST_USERS.readOnly.email);
    await page.getByRole("textbox", { name: "Password" }).fill(TEST_USERS.readOnly.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole("heading", { name: "Get Help", level: 1 })).toBeVisible();
  });

  test("no guide text reaches a signed-out browser: a redirect, not the page", async ({ request }) => {
    for (const path of ["/help", "/help?q=reviews"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBeGreaterThanOrEqual(300);
      expect(res.status(), path).toBeLessThan(400);
      expect(res.headers()["location"], path).toContain("/sign-in");
      expect(await res.text(), path).not.toContain("Connecting source systems");
    }
  });

  test("the assistant's API answers 401 with no guide text", async ({ request }) => {
    const res = await request.post("/api/v1/help/ask", { data: { question: "how do I connect Saviynt?" } });
    expect(res.status()).toBe(401);
    const body = await res.text();
    expect(body).toContain("UNAUTHENTICATED");
    expect(body).not.toContain("/help#");
  });

  test("the landing page and the sign-in screen no longer link to the guide", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('a[href^="/help"]')).toHaveCount(0);
    await page.goto("/sign-in");
    await expect(page.locator('a[href^="/help"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Need help? Email us" })).toHaveAttribute("href", /^mailto:/);
  });

  test("the pages that stay public still load with no session", async ({ page, request }) => {
    for (const [path, heading] of [
      ["/sign-in", "Sign in to WonderID"],
      ["/sign-up", null],
      ["/forgot-password", null],
    ] as const) {
      await page.goto(path);
      await expect(page, path).toHaveURL(new RegExp(path));
      if (heading) await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    const securityTxt = await request.get("/.well-known/security.txt");
    expect(securityTxt.status()).toBe(200);
  });
});

test.describe("help centre (signed in)", () => {
  test.use({ storageState: authFile("adminOne") });

  test("the account menu's Get Help link opens the guide", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /e2e-admin-1@/ }).click();
    await page.getByRole("menuitem", { name: "Get Help" }).click();
    await expect(page).toHaveURL(/\/help/);
    await expect(page.getByRole("heading", { name: "Get Help", level: 1 })).toBeVisible();
  });

  test("the header help icon opens the guide", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Get Help" }).click();
    await expect(page).toHaveURL(/\/help/);
    await expect(page.getByRole("heading", { name: "Get Help", level: 1 })).toBeVisible();
  });

  test("is not indexed or publicly cached", async ({ page }) => {
    const res = await page.goto("/help");
    expect(res?.headers()["cache-control"] ?? "").not.toMatch(/public|s-maxage/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("offers the WonderID team's email link without printing the address", async ({ page }) => {
    await page.goto("/help");
    const link = page.getByRole("link", { name: "email the WonderID team" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /^mailto:/);
    await expect(page.locator("main")).not.toContainText("@");
  });

  test("the header offers Back to app, not the signed-out CTAs", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("link", { name: "Back to app" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get started" })).toHaveCount(0);
  });

  test("renders the guide sections and the FAQ", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "Approved (SHOULD) vs Effective Access (CAN) vs Observed (DID)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connecting source systems" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Why do I have no findings?" })).toBeVisible();
  });

  test("every contents link points at a section that exists on the page", async ({ page }) => {
    // Guards the property the assistant also depends on: a link in the
    // guide must resolve to a real anchor, never a dangling one.
    await page.goto("/help");
    const hrefs = await page
      .locator('nav[aria-label="Guide contents"] a')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(10);
    for (const href of hrefs) {
      expect(href.startsWith("#")).toBe(true);
      await expect(page.locator(href)).toHaveCount(1);
    }
  });

  test("the assistant answers a question and links the matching guide section", async ({ page }) => {
    await page.goto("/help");
    await page.getByLabel("Ask a question about WonderID").fill("how do I connect Saviynt?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    // The answer's own section link is what retrieval chose — assert it
    // resolves to a real section on this page rather than just appearing.
    // Scoped to the answer list: the same title also appears in the page's
    // contents nav, which is a different link entirely.
    const answers = page.getByRole("list", { name: "Assistant answers" });
    const sectionLink = answers.getByRole("link", { name: "Connecting source systems" });
    await expect(sectionLink).toBeVisible({ timeout: 15_000 });
    await expect(sectionLink).toHaveAttribute("href", "/help#integrations");
    await expect(page.locator("#integrations")).toHaveCount(1);
  });

  test("a suggested question works the same way", async ({ page }) => {
    await page.goto("/help");
    await page.getByRole("button", { name: "Why do I have no findings?" }).click();
    await expect(page.getByText(/agents without contracts|imported data/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("a question the guide doesn't cover says so instead of inventing an answer", async ({ page }) => {
    await page.goto("/help");
    await page.getByLabel("Ask a question about WonderID").fill("zebra giraffe hippopotamus");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText(/couldn't find anything in the user guide/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
