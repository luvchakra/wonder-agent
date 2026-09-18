import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * The user guide, FAQ and help assistant at /help, reachable from the
 * account menu's "Get Help".
 *
 * Runs as a seeded tenant admin because /help lives inside the
 * authenticated shell. The assistant is exercised for real against the
 * running app — with no AI provider configured on this deployment it
 * answers from the guide text, which is the fallback path this suite
 * deliberately covers (the AI path is unit-tested in
 * lib/ai/helpAnswer.test.ts, where the provider can be mocked).
 */
test.use({ storageState: authFile("adminOne") });

test.describe("help centre", () => {
  test("the account menu's Get Help link opens the guide", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /e2e-admin-1@/ }).click();
    await page.getByRole("menuitem", { name: "Get Help" }).click();
    await expect(page).toHaveURL(/\/help/);
    await expect(page.getByRole("heading", { name: "Get Help", level: 1 })).toBeVisible();
  });

  test("renders the guide sections and the FAQ", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "SHOULD vs CAN vs DID" })).toBeVisible();
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
