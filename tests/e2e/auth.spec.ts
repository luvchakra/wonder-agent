import { test, expect } from "@playwright/test";
import { E2E_PASSWORD, TEST_USERS, authFile } from "./support/testUsers";

/**
 * QA-P0-06 — Authentication suite. Exercises real Supabase Auth (not
 * mocked) through the actual sign-in/sign-up/sign-out UI, plus the RBAC
 * and tenant-isolation guarantees every other spec's seeded identities
 * depend on. See docs/design/qa-agent-backlog-audit.md for what this
 * suite intentionally does and does not cover (SSO/MFA round-trips are
 * out of scope — see QA-P0-06's own notes).
 */

test.describe("unauthenticated", () => {
  test("visiting a protected route redirects to sign-in", async ({ page }) => {
    await page.goto("/agents");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sign-in with a wrong password shows an error and does not navigate away", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(TEST_USERS.adminOne.email);
    await page.getByLabel("Password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sign-in with correct credentials reaches Overview", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(TEST_USERS.adminOne.email);
    await page.getByLabel("Password").fill(TEST_USERS.adminOne.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  test("session-expired query param shows the expected notice", async ({ page }) => {
    await page.goto("/sign-in?reason=expired");
    await expect(page.getByText(/your session expired/i)).toBeVisible();
  });

  test("sign-up with an already-registered email surfaces the real Supabase error", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(TEST_USERS.adminOne.email);
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByText(/already registered|already exists|user already registered/i)).toBeVisible();
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("sign-up with a password under the 8-character minimum is blocked client-side", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(`pw-too-short-${Date.now()}@e2e.wonderagent.test`);
    await page.getByLabel("Password").fill("short1");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    // Native HTML5 minLength validation blocks the form submit entirely —
    // never reaches the server action, so the URL never changes.
    await expect(page).toHaveURL(/\/sign-up/);
    const isValid = await page.getByLabel("Password").evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(isValid).toBe(false);
  });

  test("sign-up with a fresh, valid email does not error and leaves the sign-up page", async ({ page }) => {
    const email = `pw-signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.wonderagent.test`;
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    // Whether this Supabase project requires email confirmation determines
    // the exact landing page (an immediate session -> /onboarding; no
    // session yet -> /onboarding's own redirect to /sign-in) — both are a
    // successful, error-free signup. What must never happen is staying on
    // /sign-up with an error.
    await expect(page).not.toHaveURL(/\/sign-up/, { timeout: 10_000 });
  });
});

test.describe("sign-out", () => {
  test.use({ storageState: authFile("adminOne") });

  test("logs out via the account menu and can no longer reach a protected route", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: TEST_USERS.adminOne.email }).click();
    await page.getByRole("menuitem", { name: "Log Out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/agents");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("RBAC — negative permission checks", () => {
  test("a READ_ONLY user is redirected away from a role.manage-gated page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("readOnly") });
    const page = await context.newPage();
    await page.goto("/settings/roles");
    await expect(page).toHaveURL("/settings");
    await context.close();
  });

  test("a READ_ONLY user hits the designed error boundary submitting an agent.create-gated action", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("readOnly") });
    const page = await context.newPage();
    await page.goto("/agents/new");
    await page.getByLabel("Agent name").fill("Should never be created");
    await page.getByLabel("Agent type").fill("automation");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page.getByText(/an unexpected error occurred/i)).toBeVisible();
    await context.close();
  });

  test("a REQUESTER (agent.read + integration.read only) can view agents but not policies", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("requester") });
    const page = await context.newPage();
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "AI Agents" })).toBeVisible();

    await page.goto("/policies");
    await expect(page.getByText(/an unexpected error occurred/i)).toBeVisible();
    await context.close();
  });
});

test.describe("tenant isolation (UI level)", () => {
  test("Tenant One's admin cannot reach an agent created in Tenant Two by direct URL", async ({ browser }) => {
    const tenantTwoContext = await browser.newContext({ storageState: authFile("adminTwo") });
    const tenantTwoPage = await tenantTwoContext.newPage();
    const agentName = `E2E Isolation Probe ${Date.now()}`;
    await tenantTwoPage.goto("/agents/new");
    await tenantTwoPage.getByLabel("Agent name").fill(agentName);
    await tenantTwoPage.getByLabel("Agent type").fill("automation");
    await tenantTwoPage.getByRole("button", { name: "Register", exact: true }).click();
    await expect(tenantTwoPage).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
    const agentUrl = tenantTwoPage.url();
    await tenantTwoContext.close();

    const tenantOneContext = await browser.newContext({ storageState: authFile("adminOne") });
    const tenantOnePage = await tenantOneContext.newPage();
    const response = await tenantOnePage.goto(agentUrl);
    expect(response?.status()).toBe(404);
    await expect(tenantOnePage.getByText(agentName)).not.toBeVisible();
    await tenantOneContext.close();
  });
});
