import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * The user guide, FAQ and help assistant at /help.
 *
 * /help is public (2026-09-18): reachable from the account menu's "Get
 * Help" when signed in, but also from the landing page nav/footer and the
 * auth screens' "Need help?" link with no session at all — it is product
 * documentation, identical for every visitor, containing no customer data.
 * The signed-out describe block below covers that directly; the signed-in
 * block covers the in-app entry point and is otherwise identical, since
 * the page itself does not vary by auth state.
 *
 * The assistant is exercised for real against the running app — with no
 * AI provider configured on this deployment it answers from the guide
 * text, which is the fallback path this suite deliberately covers (the AI
 * path is unit-tested in lib/ai/helpAnswer.test.ts, where the provider can
 * be mocked).
 */
test.describe("help centre (signed out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/help is reachable with no session — no redirect to sign-in", async ({ page }) => {
    await page.goto("/help");
    await expect(page).toHaveURL(/\/help/);
    await expect(page.getByRole("heading", { name: "Get Help", level: 1 })).toBeVisible();
  });

  test("the landing page nav and footer link to /help", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Help", exact: true }).first().click();
    await expect(page).toHaveURL(/\/help/);
    await expect(page.getByRole("heading", { name: "Get Help", level: 1 })).toBeVisible();
  });

  test("the sign-in screen's \"Need help?\" link reaches the guide", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Need help?" }).click();
    await expect(page).toHaveURL(/\/help/);
  });

  test("renders the guide sections and the FAQ", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "Approved (SHOULD) vs Effective Access (CAN) vs Observed (DID)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connecting source systems" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Why do I have no findings?" })).toBeVisible();
  });

  test("the assistant answers a question anonymously, retrieval-only", async ({ page }) => {
    await page.goto("/help");
    await page.getByLabel("Ask a question about WonderAgent").fill("how do I connect Saviynt?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    const answers = page.getByRole("list", { name: "Assistant answers" });
    const sectionLink = answers.getByRole("link", { name: "Connecting source systems" });
    await expect(sectionLink).toBeVisible({ timeout: 15_000 });
    await expect(sectionLink).toHaveAttribute("href", "/help#integrations");

    // No tenant to resolve a provider for — a signed-out caller always gets
    // the retrieval-only path (app/api/v1/help/ask/route.ts), never an AI
    // provider call.
    await expect(page.getByText("Answered straight from the guide text, not AI-generated.")).toBeVisible();
  });

  test("the header offers Log in / Get started, not app chrome", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to app" })).toHaveCount(0);
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
    await page.getByLabel("Ask a question about WonderAgent").fill("how do I connect Saviynt?");
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
    await page.getByLabel("Ask a question about WonderAgent").fill("kubernetes helm chart rollout");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText(/couldn't find anything in the user guide/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
