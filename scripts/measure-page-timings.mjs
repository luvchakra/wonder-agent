#!/usr/bin/env node
/**
 * Measures how fast the signed-in app actually loads, route by route.
 *
 * For each route it reports the median of N warm runs of:
 *   TTFB  — time to first byte: how long the server took before it started
 *           responding (auth, tenant context, the page's first data wave)
 *   DCL   — DOMContentLoaded: the document parsed and the first paint done
 *   load  — window load: every streamed panel and lazy chunk in
 *
 * Usage:
 *   WONDERAGENT_EMAIL=... WONDERAGENT_PASSWORD=... node scripts/measure-page-timings.mjs
 *
 * Optional:
 *   WONDERAGENT_BASE_URL   default http://localhost:3100
 *   RUNS                   warm runs per route, default 3
 *   E2E_CHROMIUM_PATH      use a Chromium already on the machine
 *
 * Run it before and after a change; the numbers are only meaningful as a
 * pair on the same machine against the same database, since most of the
 * time is network round trips to Supabase.
 *
 * Baseline recorded 2026-09-18 from a container ~270ms from the database:
 * every page ~1,350ms TTFB before the request-level auth/tenant caching
 * landed, ~560ms after (two round trips). From a Vercel region co-located
 * with the database those two trips are tens of milliseconds.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.WONDERAGENT_BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.WONDERAGENT_EMAIL;
const PASSWORD = process.env.WONDERAGENT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set WONDERAGENT_EMAIL and WONDERAGENT_PASSWORD to a user of the tenant to measure.");
  process.exit(1);
}
const ROUTES = ["/", "/agents", "/runtime", "/risk", "/compliance/campaigns", "/settings", "/audit"];
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/sign-in`);
await page.getByLabel("Email").fill(EMAIL);
await page.getByLabel("Password").fill(PASSWORD);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 25000 });
const runs = Number(process.env.RUNS ?? 3);
console.log("route".padEnd(24), "TTFB(ms)".padStart(9), "DCL(ms)".padStart(9), "load(ms)".padStart(9), " (median of", runs, "warm runs)");
for (const route of ROUTES) {
  const samples = [];
  for (let i = 0; i < runs + 1; i++) {
    await page.goto(BASE + route, { waitUntil: "load" });
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return { ttfb: n.responseStart - n.requestStart, dcl: n.domContentLoadedEventEnd - n.startTime, load: n.loadEventEnd - n.startTime };
    });
    if (i > 0) samples.push(t); // first hit warms the route
  }
  const med = (k) => Math.round(samples.map((s) => s[k]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
  console.log(route.padEnd(24), String(med("ttfb")).padStart(9), String(med("dcl")).padStart(9), String(med("load")).padStart(9));
}
await browser.close();
