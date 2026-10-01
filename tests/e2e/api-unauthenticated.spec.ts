import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * QA E2E run 2026-10-01 — every API route, called with no session and no
 * credentials, must refuse. Discovered from the filesystem (app/api/**\/route.ts)
 * so a route added later is covered without editing this file.
 *
 * Needs no seeded data and no stored auth state: it is safe to run on its
 * own (`npx playwright test api-unauthenticated --no-deps`).
 *
 * Allowed outcomes for an anonymous call: 400 (input validation ran before
 * auth on a route whose body was empty), 401, 403, 404, 405. Never 2xx
 * except the routes listed in PUBLIC_BY_DESIGN, never 5xx, and never a
 * response body that leaks a stack trace or database error text.
 */

const PUBLIC_BY_DESIGN = new Set([
  // /help is public (proxy.ts PUBLIC_PATHS); anonymous callers get retrieval-only answers.
  "POST /api/v1/help/ask",
  // Pre-sign-in SSO discovery; returns only {domain, protocol} (lib/auth/sso.ts).
  "GET /api/v1/sso/domain-lookup",
]);

const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function findRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findRoutes(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const endpoints = findRoutes("app/api").flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const path = file
    .replace(/^app/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\[[^\]]+\]/g, PLACEHOLDER_ID);
  return METHODS.filter((m) => new RegExp(`export (async function|const) ${m}\\b`).test(source)).map((method) => ({ method, path }));
});

test.describe("API routes refuse anonymous callers", () => {
  test("route discovery found the API surface", () => {
    expect(endpoints.length).toBeGreaterThan(100);
  });

  for (const { method, path } of endpoints) {
    const key = `${method} ${path.replaceAll(PLACEHOLDER_ID, "[id]")}`;
    test(key, async ({ request }) => {
      const res = await request.fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        data: method === "GET" ? undefined : "{}",
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      const status = res.status();
      const body = await res.text();

      expect(status, `${key} returned ${status}`).toBeLessThan(500);
      if (!PUBLIC_BY_DESIGN.has(`${method} ${path}`)) {
        expect([400, 401, 403, 404, 405], `${key} returned ${status}: ${body.slice(0, 200)}`).toContain(status);
      }
      expect(body).not.toMatch(/\bat [\w.<>]+ \(.*:\d+:\d+\)/); // no stack frames
      expect(body).not.toMatch(/violates row-level security|duplicate key value|relation "[^"]+" does not exist/i);
    });
  }
});
