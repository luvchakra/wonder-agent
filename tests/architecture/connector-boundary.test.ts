// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Non-negotiable #20: no direct connection between WonderID and an
 * organization's data; every flow goes through the connector framework.
 * This test keeps it true as the code grows, by scanning the source:
 *
 * - Outbound: only the framework (and its SSRF-guarded fetch) calls an
 *   organization's systems. The few other server-side callers reach
 *   WonderID's own providers (AI model, email), never organization data.
 *   Browser code only calls WonderID's own API.
 * - Inbound: a route that runs without a user session is a machine
 *   endpoint, and the only machine endpoints that may receive an
 *   organization's data are the framework's receivers (/api/connect/).
 *
 * Adding to an allowlist below is a change to the architecture: it needs
 * the user's approval and a line in docs/integrations/CONNECTOR-FRAMEWORK.md.
 */

const ROOT = join(__dirname, "..", "..");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules" && !name.startsWith(".")) files(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const source = [...files(join(ROOT, "app")), ...files(join(ROOT, "modules")), ...files(join(ROOT, "lib"))].map((p) => ({
  path: relative(ROOT, p).split("\\").join("/"),
  text: readFileSync(p, "utf8"),
}));

/** Server-side code allowed to make outbound calls, and why. */
const OUTBOUND_ALLOWED: Record<string, string> = {
  "modules/integrations/outboundFetch.ts": "the SSRF-guarded fetch the framework uses",
  "modules/integrations/framework/": "the connector framework itself",
  "lib/ai/provider.ts": "WonderID's AI model provider (§19.3), not organization data",
  "modules/operations/email.ts": "WonderID's own email provider",
  "lib/users/users.ts": "WonderID's own email provider (invitations)",
};

/** Routes without a user session, and why each may exist. */
const MACHINE_ROUTES_ALLOWED: Record<string, string> = {
  "app/api/connect/": "the connector framework's receivers: the only inbound path for organization data",
  "app/api/cron/": "WonderID's own scheduled jobs (Vercel Cron, bearer CRON_SECRET)",
  "app/api/v1/billing/webhooks/": "WonderID's payment providers (signed webhooks), not organization data",
  "app/api/v1/sso/domain-lookup/": "sign-in routing by email domain, before a session exists",
};

const allowed = (path: string, list: Record<string, string>) => Object.keys(list).some((p) => path === p || (p.endsWith("/") && path.startsWith(p)));

describe("connector boundary (non-negotiable #20)", () => {
  it("only the connector framework calls out from the server", () => {
    const offenders = source
      .filter((f) => !f.text.trimStart().startsWith('"use client"'))
      .filter((f) => /\b(fetch|guardedFetch)\s*\(/.test(f.text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")))
      .filter((f) => !allowed(f.path, OUTBOUND_ALLOWED))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("browser code only calls WonderID's own API", () => {
    const offenders = source
      .filter((f) => f.text.trimStart().startsWith('"use client"'))
      .flatMap((f) => [...f.text.matchAll(/\bfetch\s*\(\s*([^,)]+)/g)].map((m) => ({ path: f.path, target: m[1].trim() })))
      .filter(({ target }) => !/^[`"']\//.test(target))
      .filter(({ target }) => !/^(url|endpoint|href|path)$/.test(target));
    expect(offenders).toEqual([]);
  });

  it("only the framework's receivers accept machine requests carrying organization data", () => {
    const sessionless = source
      .filter((f) => f.path.startsWith("app/api/") && f.path.endsWith("/route.ts"))
      .filter((f) => !/require(Any)?Permission(For)?\(|requirePlatformAdmin\(|getTenantContext\(|getSessionUser\(|auth\.getUser\(/.test(f.text))
      .map((f) => f.path)
      .filter((p) => !allowed(p, MACHINE_ROUTES_ALLOWED));
    expect(sessionless).toEqual([]);
  });

  it("the retired direct routes are gone", () => {
    const paths = source.map((f) => f.path);
    for (const retired of ["app/api/gateway/", "app/api/v1/integrations/webhooks/", "app/api/v1/integrations/mcp/[id]/events/"]) {
      expect(paths.filter((p) => p.startsWith(retired))).toEqual([]);
    }
    const runtimeEvents = source.find((f) => f.path === "app/api/v1/runtime/events/route.ts");
    expect(runtimeEvents?.text).not.toMatch(/export async function POST/);
  });
});
