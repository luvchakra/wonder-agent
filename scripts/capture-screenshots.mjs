#!/usr/bin/env node
/**
 * Captures desktop + mobile screenshots of every screen referenced in the
 * WonderAgent User Guide (docs/user-guide/WonderAgent-User-Guide.docx).
 *
 * Run this in an environment that can actually reach your Supabase
 * project (this repo's sandbox during development could not — see the
 * guide's own notes) — your machine, or a CI job.
 *
 * Usage:
 *   WONDERAGENT_EMAIL=you@example.com \
 *   WONDERAGENT_PASSWORD='your password' \
 *   node scripts/capture-screenshots.mjs
 *
 * Optional env vars:
 *   WONDERAGENT_BASE_URL          default http://localhost:3100
 *   WONDERAGENT_OUTPUT_DIR        default ./screenshots
 *   WONDERAGENT_PLATFORM_EMAIL    if set (with WONDERAGENT_PLATFORM_PASSWORD),
 *                                 also captures the /platform-admin/* screens
 *   WONDERAGENT_PLATFORM_PASSWORD
 *
 * Requires the app already running (npm run build && npm run start -- -p 3100)
 * and @playwright/test's Chromium installed (npx playwright install chromium).
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE_URL = process.env.WONDERAGENT_BASE_URL ?? "http://localhost:3100";
const OUTPUT_DIR = process.env.WONDERAGENT_OUTPUT_DIR ?? "./screenshots";
const EMAIL = process.env.WONDERAGENT_EMAIL;
const PASSWORD = process.env.WONDERAGENT_PASSWORD;
const PLATFORM_EMAIL = process.env.WONDERAGENT_PLATFORM_EMAIL;
const PLATFORM_PASSWORD = process.env.WONDERAGENT_PLATFORM_PASSWORD;

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

if (!EMAIL || !PASSWORD) {
  console.error("Set WONDERAGENT_EMAIL and WONDERAGENT_PASSWORD (a real, already-onboarded WonderAgent user) and re-run.");
  process.exit(1);
}

mkdirSync(OUTPUT_DIR, { recursive: true });

async function signIn(page, email, password) {
  await page.goto(`${BASE_URL}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/onboarding", { timeout: 15000 });
}

async function shoot(page, viewport, slug) {
  await page.setViewportSize(viewport);
  await page.waitForLoadState("networkidle").catch(() => {});
  const suffix = viewport === DESKTOP ? "desktop" : "mobile";
  await page.screenshot({ path: `${OUTPUT_DIR}/${slug}-${suffix}.png`, fullPage: true });
  console.log(`captured ${slug}-${suffix}.png`);
}

async function visitAndShoot(page, path, slug) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" }).catch(() => page.goto(`${BASE_URL}${path}`));
  await shoot(page, DESKTOP, slug);
  await shoot(page, MOBILE, slug);
}

/** Registers a small, clearly-named demo agent so every agent-scoped
 * screen (Access/Runtime/Risk detail pages) has something real to show,
 * without touching your existing agents. Safe to run repeatedly. */
async function ensureDemoAgent(page) {
  const name = "Screenshot Demo Agent";
  await page.goto(`${BASE_URL}/agents`, { waitUntil: "networkidle" });
  const existingLink = page.getByRole("link", { name }).first();
  if (await existingLink.count()) {
    await existingLink.click();
    return page.url().split("/agents/")[1];
  }
  await page.goto(`${BASE_URL}/agents/new`);
  await page.getByLabel("Agent name").fill(name);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByLabel("Purpose").fill("Illustrative agent for the WonderAgent user guide's screenshots.");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
const context = await browser.newContext();
const page = await context.newPage();

await signIn(page, EMAIL, PASSWORD);

const STATIC_SCREENS = [
  ["/", "overview"],
  ["/agents", "agents-list"],
  ["/agents/new", "agents-register-form"],
  ["/agents/discovery", "agents-discovery-inbox"],
  ["/agents/duplicates", "agents-duplicate-review"],
  ["/access", "access-applications"],
  ["/access/requests", "access-requests"],
  ["/policies", "access-policies"],
  ["/runtime", "runtime-list"],
  ["/risk", "risk-list"],
  ["/risk/rogue", "risk-rogue-agents"],
  ["/compliance/campaigns", "compliance-campaigns"],
  ["/integrations", "integrations-list"],
  ["/integrations/new", "integrations-add-form"],
  ["/integrations/jobs", "integrations-jobs"],
  ["/audit", "operations-audit-trail"],
  ["/reports", "operations-reports"],
  ["/search", "operations-search"],
  ["/settings", "settings-index"],
  ["/settings/roles", "foundation-users-roles"],
  ["/settings/sso", "foundation-sso"],
  ["/settings/security", "foundation-mfa"],
  ["/settings/notifications", "operations-notifications"],
  ["/settings/ai", "operations-ai-provider"],
];

for (const [path, slug] of STATIC_SCREENS) {
  await visitAndShoot(page, path, slug);
}

const agentId = await ensureDemoAgent(page);
await visitAndShoot(page, `/agents/${agentId}`, "identity-agent-detail");
await visitAndShoot(page, `/access/agents/${agentId}`, "access-agent-detail");
await visitAndShoot(page, `/runtime/agents/${agentId}`, "runtime-agent-detail");
await visitAndShoot(page, `/risk/agents/${agentId}`, "risk-agent-detail");

if (PLATFORM_EMAIL && PLATFORM_PASSWORD) {
  const platformContext = await browser.newContext();
  const platformPage = await platformContext.newPage();
  await signIn(platformPage, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  const PLATFORM_SCREENS = [
    ["/platform-admin", "platform-overview"],
    ["/platform-admin/tenants", "platform-tenants"],
    ["/platform-admin/features", "platform-feature-flags"],
    ["/platform-admin/branding", "platform-branding"],
    ["/platform-admin/announcements", "platform-announcements"],
    ["/platform-admin/health", "platform-health"],
    ["/platform-admin/admins", "platform-admins"],
  ];
  for (const [path, slug] of PLATFORM_SCREENS) {
    await visitAndShoot(platformPage, path, slug);
  }
  await platformContext.close();
} else {
  console.log("Skipped /platform-admin/* screens — set WONDERAGENT_PLATFORM_EMAIL/PASSWORD (an account with platform-admin access) to include them.");
}

await browser.close();
console.log(`\nDone. Screenshots are in ${OUTPUT_DIR}/ — filenames match the placeholders in the Word doc.`);
