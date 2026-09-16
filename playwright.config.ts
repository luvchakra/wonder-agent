import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// No dotenv dependency needed — Node 20.6+/22's built-in loader. CI provides
// these as real environment variables (no .env.local file there), so this
// is a local-dev convenience only.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const PORT = 3100;
/**
 * By default the suite builds and serves this repo locally. Set
 * `E2E_BASE_URL` to point it at an already-running deployment instead
 * (a Vercel preview/production URL, a staging host) — the local
 * `webServer` is then skipped entirely.
 */
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;

/**
 * Optional escape hatches for constrained environments: point Chromium at
 * a binary already on the machine (`E2E_CHROMIUM_PATH`) and/or pass extra
 * launch flags (`E2E_CHROMIUM_ARGS`, space-separated). Both are unset in
 * normal local and CI runs.
 */
const launchOptions = {
  ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  ...(process.env.E2E_CHROMIUM_ARGS ? { args: process.env.E2E_CHROMIUM_ARGS.split(" ").filter(Boolean) } : {}),
};
const launchOverrides = Object.keys(launchOptions).length > 0 ? { launchOptions } : {};
const BASE_URL = EXTERNAL_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * QA Agent's Playwright E2E suite (QA-P0-06 authentication suite +
 * QA-P0-03.1's FinanceBot central scenario, exercised as real browser
 * flows rather than SQL fixtures — see docs/plan/11-QA-AGENT-BACKLOG.md).
 * Runs against a real production build (`next build && next start`), not
 * `next dev`, so a caught error renders this app's own designed error
 * boundary (app/(customer)/error.tsx) instead of Next's dev overlay, and
 * so results reflect what actually ships. Runs against the same dev
 * Supabase project used throughout this repo's build (see
 * .env.local.example) — tests/e2e/support/seedTestData.ts seeds its own
 * `e2e-*`-namespaced tenants/users, kept deliberately distinct from every
 * `tests/**\/*.sql` fixture's `fixture-tenant-*`/`aaaaaaaa-*`/`bbbbbbbb-*`
 * namespace so a stray run can never collide with those.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"], ["list"]] : [["html", { open: "never" }], ["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...launchOverrides,
      },
      // Serial, not parallel: seeding + every role's login share the same
      // DB rows (idempotent upserts, but a genuinely concurrent insert
      // race on a first-ever run could still trip a unique constraint).
      fullyParallel: false,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...launchOverrides,
      },
      dependencies: ["setup"],
    },
  ],
});
