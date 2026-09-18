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
    await page.getByRole("textbox", { name: "Password" }).fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sign-in with correct credentials reaches the dashboard", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(TEST_USERS.adminOne.email);
    await page.getByRole("textbox", { name: "Password" }).fill(TEST_USERS.adminOne.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Agent governance posture" })).toBeVisible();
  });

  test("session-expired query param shows the expected notice", async ({ page }) => {
    await page.goto("/sign-in?reason=expired");
    await expect(page.getByText(/your session expired/i)).toBeVisible();
  });

  test("sign-up with an already-registered email is indistinguishable from a fresh one (email-enumeration protection)", async ({ page }) => {
    // This asserts a real security property, and it is the opposite of what
    // this test originally expected. With email confirmations enabled,
    // Supabase Auth deliberately does NOT reveal that an address is already
    // registered — it returns a success shaped exactly like a fresh signup
    // and sends no mail — so an attacker cannot enumerate a tenant's users
    // through this form. Verified against the live project: submitting a
    // seeded user's address produces no error and leaves /sign-up.
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(TEST_USERS.adminOne.email);
    await page.getByRole("textbox", { name: "Password" }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page).not.toHaveURL(/\/sign-up/, { timeout: 10_000 });
    await expect(page.getByText(/already registered|already exists|user already registered/i)).toHaveCount(0);
  });

  test("sign-up with a password under the 8-character minimum is blocked client-side", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(`pw-too-short-${Date.now()}@e2e.wonderagent.test`);
    await page.getByRole("textbox", { name: "Password" }).fill("short1");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    // Native HTML5 minLength validation blocks the form submit entirely —
    // never reaches the server action, so the URL never changes.
    await expect(page).toHaveURL(/\/sign-up/);
    const isValid = await page.getByRole("textbox", { name: "Password" }).evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(isValid).toBe(false);
  });

  test("sign-in with empty fields is blocked client-side and never reaches the server action", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    const emailValid = await page.getByLabel("Email").evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(emailValid).toBe(false);
  });

  test("sign-up with empty fields is blocked client-side and never reaches the server action", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-up$/);
    const emailValid = await page.getByLabel("Email").evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(emailValid).toBe(false);
  });

  test("sign-in has a Forgot password? link to /forgot-password", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test("the password reveal toggle shows and hides the typed password on sign-in", async ({ page }) => {
    await page.goto("/sign-in");
    const password = page.getByRole("textbox", { name: "Password" });
    await password.fill("correct-horse-battery-staple");
    await expect(password).toHaveAttribute("type", "password");

    const toggle = page.getByRole("button", { name: "Show password" });
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("correct-horse-battery-staple");

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("the password reveal toggle shows and hides the typed password on sign-up", async ({ page }) => {
    await page.goto("/sign-up");
    const password = page.getByRole("textbox", { name: "Password" });
    await password.fill("correct-horse-battery-staple");
    await expect(password).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("correct-horse-battery-staple");

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("the reveal toggle is a plain button — clicking it never submits the form", async ({ page }) => {
    // A <button> inside a <form> defaults to type="submit"; TextField's
    // reveal toggle must set type="button" explicitly or clicking it would
    // fire the real sign-in request with whatever partial credentials are
    // in the form.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(TEST_USERS.adminOne.email);
    await page.getByRole("textbox", { name: "Password" }).fill("not-yet-the-real-password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText(/invalid login credentials/i)).toHaveCount(0);
  });

  test("a signed-in session survives a full page reload (no bounce to /welcome or /sign-in)", async ({ page }) => {
    // Regression coverage for EXPERIENCE-P0-14's proxy.ts rewrite of "/" to
    // /welcome for signed-out visitors — a signed-in user reloading "/"
    // must keep seeing the app, never the marketing page or a forced
    // re-authentication.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(TEST_USERS.adminOne.email);
    await page.getByRole("textbox", { name: "Password" }).fill(TEST_USERS.adminOne.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Agent governance posture" })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Agent governance posture" })).toBeVisible();
  });

  test("sign-up with a fresh, valid email does not error and leaves the sign-up page", async ({ page }) => {
    // NOT the @e2e.wonderagent.test domain the seeded identities use:
    // GoTrue validates the address on the signup path and rejects the
    // reserved `.test` TLD outright ("Email address ... is invalid"), so no
    // signup through this form can ever succeed with it. The seeded users
    // only exist because they are inserted server-side, which skips that
    // validation. example.com is reserved by RFC 2606 and has a real TLD.
    const email = `pw-signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    // Whether this Supabase project requires email confirmation determines
    // the exact landing page (an immediate session -> /onboarding; no
    // session yet -> /onboarding's own redirect to /sign-in) — both are a
    // successful, error-free signup.
    //
    // A genuinely fresh signup sends a confirmation email, and the project's
    // built-in SMTP allows only a couple of those per hour, so on a repeated
    // run the provider answers "email rate limit exceeded" instead. That is
    // the provider throttling us, not a defect, and it is not something the
    // app can route around. So the assertion is: the app must either
    // complete the signup, or surface the provider's own message — never
    // fail silently or throw. Configure custom SMTP (or enable auto-confirm)
    // on the project and this tightens back up to the strict form on the
    // first branch alone.
    const left = await page
      .waitForURL((u) => !/\/sign-up/.test(u.pathname), { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!left) {
      await expect(page.getByText(/email rate limit exceeded/i)).toBeVisible();
    }
  });
});

test.describe("rate limiting — FOUNDATION-P0-05.3", () => {
  // Every identity here is freshly generated and used only within its own
  // test, deliberately never TEST_USERS.adminOne/etc — tripping a shared
  // bucket here would spuriously block every other spec that signs in as
  // one of those identities for the rest of the window.

  test("sign-in is blocked with the rate-limit message once the per-email attempt limit is reached", async ({ page }) => {
    const email = `e2e-ratelimit-signin-${Date.now()}@e2e.wonderagent.test`;
    await page.goto("/sign-in");
    for (let attempt = 0; attempt < 10; attempt++) {
      await page.getByLabel("Email").fill(email);
      await page.getByRole("textbox", { name: "Password" }).fill("definitely-the-wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    }
    // The 11th attempt against the SAME email within the 5-minute window is
    // our own rate limiter, not Supabase — a distinct, actionable message
    // rather than another "invalid login credentials".
    await page.getByLabel("Email").fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/too many sign-in attempts/i)).toBeVisible();
  });

  test("distinct emails signing in from the same client are never cross-blocked by a shared/non-distinguishing IP bucket", async ({ page }) => {
    // Regression test for the defect found in this project's own
    // auth_rate_limit_attempts table (2026-09-17): the sign-in server
    // action's IP bucket (app/actions/auth.ts) keyed on whatever
    // `x-forwarded-for` resolves to for this client — "unknown" with no
    // header at all (true for a direct connection to a local/preview
    // deployment with nothing in front of it), which every unrelated
    // visitor collapsed into. Ten failed sign-ins by anyone, for any
    // account, exhausted that one shared bucket and then blocked every
    // other visitor's sign-in for the rest of the window — indistinguishable
    // from "login is broken" to the next real user, whose own credentials
    // and attempt count were never the issue. isDistinguishingClientIp()
    // (lib/security/rateLimiter.ts) now excludes exactly this kind of
    // address from IP-bucket enforcement, so only the per-email bucket
    // (which is correctly scoped to one account) can ever block a sign-in.
    //
    // Eleven distinct, never-before-used identities from the one Playwright
    // client: before the fix, the 11th would have been blocked by the
    // shared IP bucket regardless of its own (empty) history. After the
    // fix, it is evaluated purely on its own — still-empty — per-email
    // bucket, so it reaches Supabase and gets Supabase's own answer.
    await page.goto("/sign-in");
    for (let i = 0; i < 11; i++) {
      const email = `e2e-ratelimit-ip-${Date.now()}-${i}@e2e.wonderagent.test`;
      await page.getByLabel("Email").fill(email);
      await page.getByRole("textbox", { name: "Password" }).fill("definitely-the-wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
      await expect(page.getByText(/too many sign-in attempts/i)).toHaveCount(0);
    }
  });

  test("sign-up is blocked with the rate-limit message once the per-email attempt limit is reached", async ({ page }) => {
    // Real-TLD address — GoTrue rejects .test outright on the signup path
    // (see the "fresh, valid email" test above), and every attempt here
    // must reach our own checkAndRecordAttempt() regardless of what
    // Supabase itself does with the address afterwards.
    const email = `e2e-ratelimit-signup-${Date.now()}@example.com`;
    await page.goto("/sign-up");
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.getByLabel("Email").fill(email);
      await page.getByRole("textbox", { name: "Password" }).fill(E2E_PASSWORD);
      await page.getByRole("button", { name: "Sign up", exact: true }).click();
      // Not asserted further here — Supabase's own response to a repeat
      // submission of the same address (success-shaped, or its own SMTP
      // throttling) isn't this test's concern; only that our rate limiter
      // has now recorded 5 attempts for this email within the hour.
      await page.waitForTimeout(300);
      await page.goto("/sign-up");
    }
    await page.getByLabel("Email").fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByText(/too many sign-up attempts/i)).toBeVisible();
  });
});

test.describe("password reset — forgot/update password", () => {
  // Serial: the round-trip test signs passwordResetOnly out with global
  // scope (supabase.auth.signOut()'s default), which — like the sign-out
  // describe block below — would revoke any other in-flight session for
  // that same identity. The mismatched-confirmation test below also opens
  // a fresh recovery session for passwordResetOnly, so the two must never
  // overlap.
  test.describe.configure({ mode: "serial" });

  test("requesting a reset shows the same generic message for a registered and an unregistered email (enumeration protection)", async ({ page }) => {
    // Same property as the sign-up enumeration test above: Supabase Auth
    // does not reveal account existence through this call, and the UI
    // never distinguishes the two cases either. Unlike sign-up's own
    // enumeration test, a reset request for an address that DOES have an
    // account sends a real email, so it competes with every other spec's
    // signups for this project's built-in-SMTP quota (documented on the
    // "fresh, valid email" sign-up test above: a couple sends per hour) —
    // asserting the generic message OR Supabase's own quota message is the
    // same defensive pattern that test already established. Either way,
    // nothing enumeration-revealing may appear for either address.
    async function submitAndCheck(email: string) {
      await page.goto("/forgot-password");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Send reset link", exact: true }).click();
      await expect(page.getByText(/if an account exists|email rate limit exceeded/i)).toBeVisible();
      await expect(page.getByText(/no account|not found|no user|does not exist/i)).toHaveCount(0);
    }
    await submitAndCheck(TEST_USERS.adminOne.email);
    await submitAndCheck(`no-such-account-${Date.now()}@e2e.wonderagent.test`);
  });

  test("reset requests are blocked with the rate-limit message once the per-email attempt limit is reached", async ({ page }) => {
    const email = `e2e-ratelimit-reset-${Date.now()}@e2e.wonderagent.test`;
    await page.goto("/forgot-password");
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Send reset link", exact: true }).click();
      // Not asserted further here — same reasoning as the sign-up
      // rate-limit test above: checkAndRecordAttempt() runs before
      // Supabase is ever called, so these 5 attempts are recorded
      // regardless of whether Supabase's own SMTP quota lets each one
      // through; only the 6th attempt (below) is this test's concern.
      await page.waitForTimeout(300);
      await page.goto("/forgot-password");
    }
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link", exact: true }).click();
    await expect(page.getByText(/too many password reset requests/i)).toBeVisible();
  });

  test("visiting /update-password without an active recovery session shows the expired-link state, not a bare form", async ({ page }) => {
    await page.goto("/update-password");
    await expect(page.getByText(/link expired/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
  });

  // NOT covered here: clicking a real recovery link through to
  // /update-password and completing the change. Confirmed instead by two
  // other means — see docs/design/foundation-agent-backlog-audit.md's
  // entry on this feature for the full account:
  //
  // 1. Queried auth.flow_state directly after a real
  //    requestPasswordResetAction() call from this suite's own "generic
  //    message" test above: it recorded a PKCE row
  //    (code_challenge_method "s256", code_challenge present) for that
  //    user, proving the request half of the real flow — the one that
  //    matters for app/auth/callback/route.ts's exchangeCodeForSession()
  //    to work — is wired correctly.
  // 2. app/actions/auth.test.ts unit-tests updatePasswordAction() and
  //    requestPasswordResetAction() directly (session guard, rate
  //    limiting, the redirectTo shape, error surfacing), and
  //    app/auth/callback/route.test.ts covers the `next` open-redirect
  //    guard.
  //
  // What's NOT verified end to end: actually clicking a recovery link and
  // landing on /update-password with a live session. Supabase Auth's
  // admin.generateLink() (the only way to mint a verification link
  // without sending real mail) does not go through the PKCE
  // code_challenge a real resetPasswordForEmail() call negotiates, so it
  // redirects with tokens in a URL fragment instead of `?code=` and can't
  // exercise this app's callback route. Driving the real thing needs a
  // real inbox this environment doesn't have, and this project's
  // built-in-SMTP quota was already exhausted by this same test run.
  // Same category of gap as the SSO callback's own documented caveat
  // above this file's rate-limiting tests. Flagged rather than faked.
});

test.describe("sign-out", () => {
  // Signs in as its OWN dedicated identity rather than reusing a saved
  // storage state. signOutAction() calls supabase.auth.signOut(), whose
  // default scope in supabase-js v2 is "global": it revokes every refresh
  // token that user holds. Sharing an identity here logged every other
  // parallel spec out mid-run — 39 failures traced back to this one test
  // the first time its selector worked.
  test("logs out via the account menu and can no longer reach a protected route", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(TEST_USERS.signOutOnly.email);
    await page.getByRole("textbox", { name: "Password" }).fill(TEST_USERS.signOutOnly.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/");
    // Since EXPERIENCE-P0-15 the navigation rail is permanent at this
    // viewport, so the account trigger at its foot is directly reachable —
    // no drawer to open first.
    await page.getByRole("button", { name: TEST_USERS.signOutOnly.email }).click();
    await page.getByRole("menuitem", { name: "Log Out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/agents");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("signing out is global — it ends the user's other sessions too", async ({ browser }) => {
    // Asserts a deliberate product decision (user, 2026-09-17): logout
    // revokes every refresh token the user holds, not just the current
    // session. Two independent contexts, same identity; logging out of one
    // must invalidate the other. Uses the dedicated sign-out identity for
    // the same reason the test above does — a global revocation would
    // otherwise take every parallel spec's session with it.
    const first = await browser.newContext();
    const second = await browser.newContext();
    const pages = [];
    for (const ctx of [first, second]) {
      const page = await ctx.newPage();
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(TEST_USERS.signOutOnly.email);
      await page.getByRole("textbox", { name: "Password" }).fill(TEST_USERS.signOutOnly.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL("/");
      pages.push(page);
    }
    const [sessionA, sessionB] = pages;

    await sessionA.getByRole("button", { name: TEST_USERS.signOutOnly.email }).click();
    await sessionA.getByRole("menuitem", { name: "Log Out" }).click();
    await expect(sessionA).toHaveURL(/\/sign-in/);

    // The other session's refresh token is now revoked server-side.
    await sessionB.goto("/agents");
    await expect(sessionB).toHaveURL(/\/sign-in/);

    await first.close();
    await second.close();
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
    await tenantOnePage.goto(agentUrl);
    // Asserting the rendered result rather than the HTTP status on purpose:
    // the (customer) layout streams its shell before the page component runs
    // notFound(), so the 200 is already committed by the time Next knows —
    // the body is still the 404 page. Verified directly that this is a
    // status-code artefact and not a leak: tenant two's agent name never
    // appears in tenant one's DOM, and getAgent() reads through RLS-scoped
    // supabaseServer(), so the row is invisible at the database layer.
    await expect(tenantOnePage.getByText(/This page could not be found|404/i).first()).toBeVisible();
    await expect(tenantOnePage.getByText(agentName)).toHaveCount(0);
    await tenantOneContext.close();
  });
});
