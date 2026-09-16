/**
 * QA Agent — live tenant-isolation proof driven through a REAL Supabase
 * JS client session (not `set_config('request.jwt.claims', ...)` role
 * simulation, and not a service-role connection).
 *
 * Every prior module proved isolation by simulating the JWT server-side,
 * because the build sandbox's network egress could not reach
 * `*.supabase.co` at all (see docs/design/foundation-agent-backlog-audit.md's
 * FOUNDATION-P0-07 entry). This script is the half that was deferred: two
 * genuinely authenticated PostgREST sessions, signed in with email and
 * password through GoTrue, exercising every tenant-scoped table over HTTPS
 * exactly as the browser does.
 *
 * Fixture: the `e2e-*` tenants/users/rows seeded for the Playwright suite
 * (tests/e2e/support/*), so this asserts against data that genuinely
 * exists in both tenants — a zero-row result only proves isolation when
 * the other tenant's rows are known to be there.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
 *     node tests/live-client-tenant-isolation.mjs
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.local.example).");
  process.exit(2);
}

const PASSWORD = process.env.E2E_PASSWORD ?? "E2E-Test-Passw0rd!1";
const USER_A = "e2e-admin-1@e2e.wonderagent.test";
const USER_B = "e2e-admin-2@e2e.wonderagent.test";

/** Every public table carrying a tenant_id, as of migration 0056. */
const TENANT_SCOPED_TABLES = [
  "access_grants", "access_requests", "accounts", "agent_contracts",
  "agent_duplicate_candidates", "agent_identities", "agent_lifecycle_events",
  "agent_owners", "agent_relationships", "agents", "applications", "audit_logs",
  "certification_campaigns", "certification_items", "control_mappings",
  "entitlements", "feature_flags", "governance_attestations",
  "integration_credentials", "integration_objects", "integration_sync_jobs",
  "integrations", "notification_preferences", "notifications",
  "platform_ai_provider_configs", "platform_announcements", "platform_audit_logs",
  "platform_tenants", "policies", "policy_evaluations", "policy_exceptions",
  "reports", "risk_findings", "risk_severity_weights", "roles",
  "runtime_event_quarantine", "runtime_events", "runtime_resources",
  "runtime_tools", "sso_connections", "subscriptions", "tenant_memberships",
  "tenant_settings", "user_roles",
];

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

function anonClient() {
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(email) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  const { data: membership, error: mErr } = await client
    .from("tenant_memberships").select("tenant_id").eq("user_id", data.user.id).single();
  if (mErr) throw new Error(`tenant lookup failed for ${email}: ${mErr.message}`);
  return { client, userId: data.user.id, tenantId: membership.tenant_id };
}

async function main() {
  const a = await signIn(USER_A);
  const b = await signIn(USER_B);
  console.log(`Tenant A = ${a.tenantId} (${USER_A})`);
  console.log(`Tenant B = ${b.tenantId} (${USER_B})\n`);
  check(a.tenantId !== b.tenantId, "the two sessions resolve to different tenants");

  // 1. Read isolation across every tenant-scoped table, both directions.
  console.log("\n[1] Read isolation — no session may see another tenant's rows");
  for (const table of TENANT_SCOPED_TABLES) {
    for (const [self, other, name] of [[a, b, "A"], [b, a, "B"]]) {
      const { data, error } = await self.client.from(table).select("tenant_id").limit(1000);
      if (error) {
        // A table a customer role may not read at all is isolation working, not a failure.
        check(true, `${table} as ${name}`, `blocked: ${error.message}`);
        continue;
      }
      const leaked = data.filter((r) => r.tenant_id === other.tenantId).length;
      const foreign = data.filter((r) => r.tenant_id !== self.tenantId && r.tenant_id !== null).length;
      check(leaked === 0 && foreign === 0, `${table} as ${name}`,
        `${data.length} own row(s), ${leaked} from the other tenant, ${foreign} foreign`);
    }
  }

  // 2. The negative is only meaningful if the other tenant's rows really exist.
  console.log("\n[2] Fixture reality check — each tenant can see its own seeded rows");
  for (const table of ["agents", "applications", "risk_findings", "runtime_events", "audit_logs", "notifications"]) {
    for (const [self, name] of [[a, "A"], [b, "B"]]) {
      const { count, error } = await self.client.from(table).select("*", { count: "exact", head: true });
      check(!error && (count ?? 0) > 0, `${table} visible to ${name}`, error ? error.message : `${count} row(s)`);
    }
  }

  // 3. Direct primary-key lookup of a known foreign row.
  console.log("\n[3] Direct foreign primary-key lookup returns nothing");
  const { data: bAgents } = await b.client.from("agents").select("id, agent_name").limit(1);
  const bAgentId = bAgents?.[0]?.id;
  if (!bAgentId) {
    check(false, "tenant B has a seeded agent to target");
  } else {
    const { data: probe, error } = await a.client.from("agents").select("id").eq("id", bAgentId);
    check(!error && (probe?.length ?? 0) === 0, "A reading B's agent by id", `${probe?.length ?? 0} row(s)`);

    // 4. Writes against a foreign row.
    console.log("\n[4] Writes against another tenant's data");
    const { data: upd, error: updErr } = await a.client
      .from("agents").update({ agent_name: "HIJACKED" }).eq("id", bAgentId).select("id");
    check((upd?.length ?? 0) === 0, "A updating B's agent", updErr ? `rejected: ${updErr.message}` : `${upd?.length ?? 0} row(s) affected`);

    const { data: del, error: delErr } = await a.client.from("agents").delete().eq("id", bAgentId).select("id");
    check((del?.length ?? 0) === 0, "A deleting B's agent", delErr ? `rejected: ${delErr.message}` : `${del?.length ?? 0} row(s) affected`);

    const { error: insErr } = await a.client
      .from("agents").insert({ tenant_id: b.tenantId, agent_name: "E2E cross-tenant insert", agent_type: "llm_agent" }).select("id");
    check(!!insErr, "A inserting an agent into B's tenant", insErr ? `rejected: ${insErr.message}` : "ACCEPTED — RLS hole");

    const { error: auditErr } = await a.client
      .from("audit_logs").insert({ tenant_id: b.tenantId, actor_type: "user", action: "e2e.forged", object_type: "tenant", object_id: b.tenantId, outcome: "success" });
    check(!!auditErr, "A forging an audit_logs row for B", auditErr ? `rejected: ${auditErr.message}` : "ACCEPTED — audit integrity hole");

    // The agent must be untouched afterwards.
    const { data: after } = await b.client.from("agents").select("agent_name").eq("id", bAgentId).single();
    check(after?.agent_name !== "HIJACKED" && !!after, "B's agent survived A's write attempts", after?.agent_name);
  }

  // 5. Unauthenticated (anon) access.
  console.log("\n[5] Unauthenticated anon key sees no customer data");
  const anon = anonClient();
  for (const table of TENANT_SCOPED_TABLES) {
    const { data, error } = await anon.from(table).select("tenant_id").limit(10);
    check(!!error || (data?.length ?? 0) === 0, `${table} as anon`, error ? `blocked: ${error.message}` : `${data.length} row(s)`);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
