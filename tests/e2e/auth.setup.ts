import { test as setup, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { clearAuthRateLimits, pruneThrowawayAgents, pruneThrowawayIntegrationsAndQuarantine, seedTestData } from "./support/seedTestData";
import { TEST_USERS, authFile, type TestUserKey } from "./support/testUsers";

mkdirSync("tests/e2e/.auth", { recursive: true });

// A plain top-level `beforeAll` (not a `setup(...)` test) so it always
// completes before any of this file's per-role sign-in tests start,
// regardless of `fullyParallel`/worker scheduling — those tests would
// otherwise race a login attempt against user/tenant rows that don't
// exist yet.
setup.beforeAll(async () => {
  // `E2E_SKIP_SEED=1` is for runs against an environment whose tenants/
  // users were already seeded out of band (and where no service-role key
  // is available to this process). The specs themselves are unaffected —
  // they only ever read the fixed identities in testUsers.ts.
  if (process.env.E2E_SKIP_SEED === "1") return;
  // Before anything logs in — otherwise a previous run's attempts can still
  // be inside the 5-minute window and throttle this one.
  await clearAuthRateLimits();
  const seeded = await seedTestData();
  expect(seeded.userIds.adminOne).toBeTruthy();
  expect(seeded.userIds.adminTwo).toBeTruthy();
  // Start from a known agent population — see pruneThrowawayAgents().
  await pruneThrowawayAgents([seeded.tenantIds.one, seeded.tenantIds.two]);
  await pruneThrowawayIntegrationsAndQuarantine([seeded.tenantIds.one, seeded.tenantIds.two]);
});

function signInAndSaveState(key: TestUserKey) {
  setup(`authenticate as ${key}`, async ({ page }) => {
    const spec = TEST_USERS[key];
    // Some hosted targets sit behind deployment protection that is
    // cleared by visiting a one-time URL which sets a bypass cookie
    // (e.g. a Vercel share link). Visiting it first means that cookie is
    // captured in the storage state every spec reuses.
    if (process.env.E2E_BOOTSTRAP_URL) {
      await page.goto(process.env.E2E_BOOTSTRAP_URL);
    }
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(spec.email);
    await page.getByRole("textbox", { name: "Password" }).fill(spec.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    if (spec.isPlatformAdmin) {
      // Zero tenant memberships by design — lands on /onboarding, never
      // redirected further. Confirm the sign-in itself succeeded (an
      // authenticated-only page renders) before saving storage state.
      await expect(page).toHaveURL(/\/onboarding/);
      await expect(page.getByRole("heading", { name: "Create a new organization" })).toBeVisible();
    } else {
      // One tenant membership each (seedTestData), so getTenantContext()
      // resolves it with no ambiguity and sign-in lands straight on
      // Overview. multiOrg has two; it lands on Overview in whichever one
      // resolves first, and its spec switches explicitly.
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("heading", { name: "AI Agent Security Overview" })).toBeVisible();
    }

    // The saved state is shared by every spec, in contexts opened at any
    // time during the run. It keeps the Supabase session but not the app's
    // own session-timing cookies (wa_session_started_at, wa_session_last_seen):
    // carried in a context opened more than the organization's idle limit
    // (30 minutes) after setup, a setup-time "last seen" made the proxy treat
    // the session as idle and sign the user out globally, ending it for every
    // other spec too (nightly of 12 October). Without them, each context's
    // clock starts at its first request, as for a fresh sign-in.
    const state = await page.context().storageState();
    state.cookies = state.cookies.filter((c) => !c.name.startsWith("wa_session_"));
    writeFileSync(authFile(key), JSON.stringify(state, null, 2));
  });
}

// signOutOnly and passwordResetOnly deliberately have no saved storage
// state: signOutOnly's one test signs in itself and then signs out (a
// globally-scoped sign-out would invalidate any state saved here anyway),
// and passwordResetOnly's one test changes its own password via the real
// reset flow, which would invalidate a storage state saved against the
// original password.
const EXCLUDED: TestUserKey[] = ["signOutOnly", "passwordResetOnly"];
for (const key of (Object.keys(TEST_USERS) as TestUserKey[]).filter((k) => !EXCLUDED.includes(k))) {
  signInAndSaveState(key);
}
