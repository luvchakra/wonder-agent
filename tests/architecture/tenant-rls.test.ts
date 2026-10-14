import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * QA-P0-02.1 — cross-tenant sweep over the schema, for every table any
 * migration creates (non-negotiable #1, §14):
 *
 * - a table with a `tenant_id` column has row-level security turned on;
 * - and at least one policy, unless it is listed below as written and read
 *   only by the service role or vendor-side (no client policy is the
 *   isolation: no customer session reads it at all).
 *
 * A table dropped later is ignored. The live negative tests (a member of one
 * organization sees nothing of another's) stay in tests/**.sql and the E2E
 * isolation specs; this catches a new table shipped without RLS.
 */

const DIR = join(__dirname, "..", "..", "supabase", "migrations");
const migrations = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, sql: readFileSync(join(DIR, f), "utf8").replace(/--[^\n]*/g, "") }));

/** No client policy by design; every read and write is the service role's, filtered by tenant in code. */
const NO_CLIENT_POLICY: Record<string, string> = {
  // Vendor-side: the platform console reads them after requirePlatformAdmin().
  platform_tenants: "vendor-only (0038)",
  subscriptions: "vendor-only (0038); customers see their plan through server code",
  feature_flags: "vendor-only (0038)",
  platform_audit_logs: "vendor-only (0038)",
  platform_announcements: "vendor-only (0047); customers get active notices through server code",
  platform_organization_profiles: "vendor-only (0162)",
  billing_webhook_events: "vendor-side webhook intake (0102)",
  billing_adjustments: "vendor-side, maker-checker (0102)",
  // Secrets and machine credentials: only the service role, filtered by tenant in code (#10).
  integration_credentials: "encrypted secrets (0021)",
  platform_ai_provider_configs: "encrypted provider keys (0057)",
  agent_api_keys: "hashed agent keys (0061)",
  connector_receivers: "receiver credentials (0109)",
  connector_files: "uploaded files, service role with a tenant filter (0111)",
  automation_credential_usage: "rate-limit counter, service role only (0126)",
};

type Table = { name: string; hasTenantId: boolean; rls: boolean; policies: number; createdIn: string };

function tables(): Map<string, Table> {
  const out = new Map<string, Table>();
  for (const { file, sql } of migrations) {
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi)) {
      const name = m[1].toLowerCase();
      out.set(name, { name, hasTenantId: /\btenant_id\b/.test(m[2]), rls: false, policies: 0, createdIn: file });
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?tenant_id\b/gi)) {
      const t = out.get(m[1].toLowerCase());
      if (t) t.hasTenantId = true;
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi)) {
      const t = out.get(m[1].toLowerCase());
      if (t) t.rls = true;
    }
    for (const m of sql.matchAll(/create\s+policy\s+(?:"[^"]+"|[a-z0-9_]+)\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
      const t = out.get(m[1].toLowerCase());
      if (t) t.policies++;
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) out.delete(m[1].toLowerCase());
  }
  return out;
}

describe("QA-P0-02.1: every tenant table is protected by RLS", () => {
  const all = tables();
  const tenantTables = [...all.values()].filter((t) => t.hasTenantId);

  it("reads the schema", () => {
    expect(all.size).toBeGreaterThan(100);
    expect(tenantTables.length).toBeGreaterThan(80);
  });

  it("row-level security is on for every table with a tenant_id", () => {
    expect(tenantTables.filter((t) => !t.rls).map((t) => `${t.name} (${t.createdIn})`)).toEqual([]);
  });

  it("each has a policy, unless it is service-role or vendor only by design", () => {
    const missing = tenantTables.filter((t) => t.policies === 0 && !(t.name in NO_CLIENT_POLICY)).map((t) => `${t.name} (${t.createdIn})`);
    expect(missing).toEqual([]);
  });

  it("the no-policy list holds only tables that exist and still have no policy", () => {
    const stale = Object.keys(NO_CLIENT_POLICY).filter((n) => !all.has(n) || all.get(n)!.policies > 0);
    expect(stale).toEqual([]);
  });
});
