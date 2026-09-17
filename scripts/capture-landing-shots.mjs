#!/usr/bin/env node
/**
 * Regenerates the product screenshots the public landing page renders
 * (assets/product/*.png), so they can be refreshed whenever the UI changes
 * instead of going stale as hand-made mockups would.
 *
 * Each screen is captured twice, light and dark: the landing page shows one
 * or the other via `.theme-light-only` / `.theme-dark-only` (app/globals.css)
 * so a shot can never disagree with the surrounding surface.
 *
 * Usage:
 *   WONDERAGENT_EMAIL=... WONDERAGENT_PASSWORD=... \
 *     node scripts/capture-landing-shots.mjs
 *
 * Optional:
 *   WONDERAGENT_BASE_URL   default http://localhost:3100
 *   E2E_CHROMIUM_PATH      use a Chromium already on the machine
 *
 * Requires the app to be running against a project whose data is worth
 * showing — a tenant with several agents, real owners and at least one open
 * finding. Sign in as a user of that tenant.
 *
 * Note: the capture deliberately runs ONE sign-in per theme. The sign-in
 * action rate-limits 10 attempts per IP per 5 minutes (app/actions/auth.ts),
 * and a shot-per-session script trips it halfway through.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.WONDERAGENT_BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.WONDERAGENT_EMAIL;
const PASSWORD = process.env.WONDERAGENT_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Set WONDERAGENT_EMAIL and WONDERAGENT_PASSWORD to a user of the tenant to capture.");
  process.exit(1);
}

const OUT_DIR = "assets/product";

/**
 * Heights are tuned so each screen's content fills its frame — a shot with
 * 200px of empty page at the bottom looks unfinished inside a browser bezel.
 * The two desktop shots shown side by side share a height so their captions
 * line up.
 */
const SHOTS = [
  { route: "/", name: "overview", vp: { width: 1360, height: 900 }, kind: "desktop" },
  { route: "/risk", name: "risk", vp: { width: 1360, height: 590 }, kind: "desktop" },
  { route: "/agents", name: "agents", vp: { width: 1360, height: 590 }, kind: "desktop" },
  { route: "/", name: "overview", vp: { width: 390, height: 780 }, kind: "mobile" },
];

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 20_000 });
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("wa-theme", t);
  }, theme);

  for (const shot of SHOTS) {
    await page.setViewportSize(shot.vp);
    await page.goto(BASE + shot.route, { waitUntil: "networkidle" });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(1200);
    const file = `${OUT_DIR}/${shot.name}-${shot.kind}-${theme}.png`;
    await page.screenshot({ path: file });
    console.log("captured", file);
  }

  await context.close();
}

await browser.close();
