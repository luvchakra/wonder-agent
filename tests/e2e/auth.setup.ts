import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedTestData } from "./support/seedTestData";
import { TEST_USERS, authFile, type TestUserKey } from "./support/testUsers";

mkdirSync("tests/e2e/.auth", { recursive: true });

// A plain top-level `beforeAll` (not a `setup(...)` test) so it always
// completes before any of this file's per-role sign-in tests start,
// regardless of `fullyParallel`/worker scheduling — those tests would
// otherwise race a login attempt against user/tenant rows that don't
// exist yet.
setup.beforeAll(async () => {
  const seeded = await seedTestData();
  expect(seeded.userIds.adminOne).toBeTruthy();
  expect(seeded.userIds.adminTwo).toBeTruthy();
});

function signInAndSaveState(key: TestUserKey) {
  setup(`authenticate as ${key}`, async ({ page }) => {
    const spec = TEST_USERS[key];
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(spec.email);
    await page.getByLabel("Password").fill(spec.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    if (spec.isPlatformAdmin) {
      // Zero tenant memberships by design — lands on /onboarding, never
      // redirected further. Confirm the sign-in itself succeeded (an
      // authenticated-only page renders) before saving storage state.
      await expect(page).toHaveURL(/\/onboarding/);
      await expect(page.getByRole("heading", { name: "Create a new organization" })).toBeVisible();
    } else {
      // Exactly one tenant membership each (seedTestData) — getTenantContext()
      // resolves it with no ambiguity, so sign-in lands straight on Overview.
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    }

    await page.context().storageState({ path: authFile(key) });
  });
}

for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
  signInAndSaveState(key);
}
