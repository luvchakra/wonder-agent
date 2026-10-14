import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * QA-P0-02.2 — RBAC boundary sweep, enumerated rather than trusted:
 *
 * 1. Every customer API route (`app/api/v1/**`) checks a named permission
 *    through the authorization engine (requirePermission / requirePermissionFor,
 *    or a per-kind permission table it enforces), unless it is listed below as
 *    self-service (the caller's own data, tenant from their membership) or
 *    public (it authenticates itself: a signed webhook).
 * 2. Every vendor route (`app/api/platform/**`) requires a platform administrator.
 * 3. Every cron route checks the cron secret.
 * 4. Every permission key the application checks exists in the permission
 *    catalogue the migrations build. A misspelt key would deny everyone (or,
 *    in a UI check, show something to nobody), silently.
 *
 * Adding a route to an allowlist needs a reason here and a reviewer's eye.
 */

const ROOT = join(__dirname, "..", "..");

function files(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, match));
    else if (match(p)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split("\\").join("/");
const routes = (dir: string) => files(join(ROOT, dir), (f) => f.endsWith("route.ts")).map((f) => ({ path: rel(f), source: readFileSync(f, "utf8") }));

const PERMISSION_GATE = /requirePermission(For)?\(|requireAnyPermission(For)?\(|REQUIRED_PERMISSION\[/;

/** The caller's own data or organization only; the tenant comes from their membership (getTenantContext). */
const SELF_SERVICE: Record<string, string> = {
  "app/api/v1/tenant/route.ts": "the caller's own organization summary",
  "app/api/v1/search/route.ts": "search() filters every result kind by the caller's read permissions",
  "app/api/v1/help/ask/route.ts": "the product guide; no organization data",
  "app/api/v1/privacy/me/route.ts": "the caller's own privacy record",
  "app/api/v1/privacy/me/export/route.ts": "the caller's own data export",
  "app/api/v1/privacy/me/consents/route.ts": "the caller's own consents",
  "app/api/v1/privacy/me/requests/route.ts": "the caller's own privacy requests",
  "app/api/v1/compliance/consultations/[id]/answer/route.ts": "the caller answers a question put to them; the service accepts only the person asked",
};

/** Called by third parties; each authenticates the call itself. */
const PUBLIC: Record<string, RegExp> = {
  "app/api/v1/billing/webhooks/stripe/route.ts": /verifyStripeSignature/,
  "app/api/v1/billing/webhooks/razorpay/route.ts": /verifyRazorpayWebhookSignature/,
  // Says only whether an email domain uses SSO, so sign-in can offer it; reveals no organization.
  "app/api/v1/sso/domain-lookup/route.ts": /./,
};

describe("QA-P0-02.2: every API route is gated", () => {
  const customer = routes("app/api/v1");

  it("finds the routes", () => {
    expect(customer.length).toBeGreaterThan(100);
  });

  it("customer routes check a permission, or are listed as self-service or public", () => {
    const ungated = customer.filter((r) => !PERMISSION_GATE.test(r.source) && !(r.path in SELF_SERVICE) && !(r.path in PUBLIC)).map((r) => r.path);
    expect(ungated).toEqual([]);
  });

  it("self-service routes resolve the tenant from the caller's membership", () => {
    for (const path of Object.keys(SELF_SERVICE)) {
      const r = customer.find((x) => x.path === path);
      expect(r, `${path} exists`).toBeTruthy();
      expect(r!.source, path).toMatch(/getTenantContext\(/);
    }
  });

  it("public routes authenticate the caller themselves", () => {
    for (const [path, check] of Object.entries(PUBLIC)) {
      const r = customer.find((x) => x.path === path);
      expect(r, `${path} exists`).toBeTruthy();
      expect(r!.source, path).toMatch(check);
    }
  });

  it("an allowlisted route that now checks a permission is taken off the list", () => {
    const stale = [...Object.keys(SELF_SERVICE), ...Object.keys(PUBLIC)].filter((p) => PERMISSION_GATE.test(customer.find((x) => x.path === p)?.source ?? ""));
    expect(stale).toEqual([]);
  });

  it("vendor routes require a platform administrator", () => {
    const open = routes("app/api/platform").filter((r) => !/requirePlatformAdmin\(/.test(r.source)).map((r) => r.path);
    expect(open).toEqual([]);
  });

  it("cron routes check the cron secret", () => {
    const open = routes("app/api/cron").filter((r) => !/CRON_SECRET/.test(r.source)).map((r) => r.path);
    expect(open).toEqual([]);
  });
});

/** Every key ever inserted into `permissions` by a migration, less any deleted later. */
function catalogue(): Set<string> {
  const keys = new Set<string>();
  const migrations = files(join(ROOT, "supabase", "migrations"), (f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    const sql = readFileSync(file, "utf8");
    for (const insert of sql.matchAll(/insert\s+into\s+(?:public\.)?permissions\b[\s\S]*?;/gi)) {
      for (const m of insert[0].matchAll(/\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)) keys.add(m[1]);
    }
    for (const del of sql.matchAll(/delete\s+from\s+(?:public\.)?permissions\b[\s\S]*?;/gi)) {
      for (const m of del[0].matchAll(/'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)) keys.delete(m[1]);
    }
  }
  return keys;
}

/** Permission keys the application checks: the gate calls and permission lookups, in app/, modules/ and lib/. */
function checkedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  const sources = ["app", "modules", "lib"].flatMap((d) => files(join(ROOT, d), (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)));
  const patterns = [
    /requirePermission(?:For)?\(\s*"([a-z0-9_.]+)"/g,
    /permissions\.includes\(\s*"([a-z0-9_.]+)"/g,
    /hasPermission\([^,"]*,?\s*"([a-z0-9_.]+)"/g,
  ];
  // requireAnyPermission(For)?(["a", "b"], …): each key in the list.
  const anyOf = /requireAnyPermission(?:For)?\(\s*\[([^\]]*)\]/g;
  for (const file of sources) {
    const src = readFileSync(file, "utf8");
    for (const re of patterns) for (const m of src.matchAll(re)) if (m[1].includes(".")) found.set(m[1], rel(file));
    for (const m of src.matchAll(anyOf)) for (const k of m[1].matchAll(/"([a-z0-9_.]+)"/g)) found.set(k[1], rel(file));
  }
  return found;
}

describe("QA-P0-02.2: permission keys", () => {
  const known = catalogue();
  const used = checkedKeys();

  it("reads the catalogue and the checks", () => {
    expect(known.size).toBeGreaterThan(30);
    expect(used.size).toBeGreaterThan(30);
  });

  it("every key the application checks is in the permission catalogue", () => {
    const unknown = [...used].filter(([key]) => !known.has(key)).map(([key, file]) => `${key} (${file})`);
    expect(unknown).toEqual([]);
  });
});

/** Server actions that must work signed out, or only end the caller's own session. */
const PUBLIC_ACTIONS = new Set([
  "app/actions/auth.ts#signInAction",
  "app/actions/auth.ts#signUpAction",
  "app/actions/auth.ts#requestPasswordResetAction",
  // Needs the recovery session Supabase set from the emailed link (checked inside: auth.getUser()).
  "app/actions/auth.ts#updatePasswordAction",
  "app/actions/tenant.ts#signOutAction",
]);

const ACTION_GATE = /requirePermission(For)?\(|requireAnyPermission(For)?\(|requirePlatformAdmin(OrBootstrap)?\(|getSessionUser\(|getTenantContext\(/;

describe("QA-P0-02.2: every server action is gated", () => {
  const actionFiles = files(join(ROOT, "app", "actions"), (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("each exported action reaches a gate, itself or through a local helper that does", () => {
    const ungated: string[] = [];
    for (const file of actionFiles) {
      const src = readFileSync(file, "utf8");
      // Function bodies, split at each top-level function declaration.
      const chunks = src.split(/(?=^(?:export\s+)?(?:async\s+)?function\s+\w+)/m);
      const gatedHelpers = new Set<string>();
      for (const c of chunks) {
        const m = /^(?:async\s+)?function\s+(\w+)/.exec(c);
        if (m && ACTION_GATE.test(c)) gatedHelpers.add(m[1]);
      }
      for (const c of chunks) {
        const m = /^export\s+async\s+function\s+(\w+)/.exec(c);
        if (!m) continue;
        const key = `${rel(file)}#${m[1]}`;
        const viaHelper = [...gatedHelpers].some((h) => new RegExp(`\\b${h}\\(`).test(c.slice(m[0].length)));
        if (!ACTION_GATE.test(c) && !viaHelper && !PUBLIC_ACTIONS.has(key)) ungated.push(key);
      }
    }
    expect(actionFiles.length).toBeGreaterThan(20);
    expect(ungated).toEqual([]);
  });
});
