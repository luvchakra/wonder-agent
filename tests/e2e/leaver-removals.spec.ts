import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * WID-C02 — when a person leaves, what they hold becomes removal work at
 * once, against the real app and database:
 * - one removal task per live grant, marked as a leaver's, due within a
 *   day, for a person to do (no connector attempt);
 * - a grant approved but never fulfilled is withdrawn;
 * - the next step (disabled, then terminated) opens nothing twice.
 */

const stamp = Date.now();
let tenantId = "";
let personId = "";
let liveGrantId = "";
let pendingGrantId = "";
let applicationId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db().from(table).insert(row).select("id").single();
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return data!.id as string;
}

test.describe.serial("a leaver's access becomes removal work", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async () => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    personId = await insert("identities", { tenant_id: tenantId, identity_type: "HUMAN", display_name: `E2E Leaver ${stamp}`, status: "active", lifecycle_state: "ACTIVE" });
    applicationId = await insert("applications", { tenant_id: tenantId, name: `e2e-leaver-app-${stamp}` });
    const accountId = await insert("accounts", { tenant_id: tenantId, application_id: applicationId, identity_id: personId, external_account_ref: `leaver-${stamp}` });
    const held = await insert("entitlements", { tenant_id: tenantId, application_id: applicationId, name: `Ledger_READ_${stamp}` });
    const asked = await insert("entitlements", { tenant_id: tenantId, application_id: applicationId, name: `Ledger_WRITE_${stamp}` });
    liveGrantId = await insert("access_grants", { tenant_id: tenantId, account_id: accountId, entitlement_id: held, grant_type: "direct" });
    pendingGrantId = await insert("access_grants", { tenant_id: tenantId, account_id: accountId, entitlement_id: asked, grant_type: "direct", fulfilment_status: "pending_fulfilment" });
  });

  test.afterAll(async () => {
    await db().from("access_fulfilment_tasks").delete().eq("tenant_id", tenantId).eq("application_id", applicationId);
    await db().from("access_grants").delete().in("id", [liveGrantId, pendingGrantId]);
    await db().from("accounts").delete().eq("tenant_id", tenantId).eq("application_id", applicationId);
    await db().from("entitlements").delete().eq("tenant_id", tenantId).eq("application_id", applicationId);
    await db().from("applications").delete().eq("id", applicationId);
  });

  test("leaving opens one removal per grant, due within a day, for a person; unfulfilled grants are withdrawn", async ({ request }) => {
    const res = await request.post(`/api/v1/identities/${personId}/lifecycle`, { data: { toState: "DISABLED", note: "Last day passed" } });
    expect(res.status(), await res.text()).toBe(201);

    const { data: tasks } = await db().from("access_fulfilment_tasks").select("kind, status, reason, due_at, created_at, connector_status, request_id").eq("tenant_id", tenantId).eq("removal_grant_id", liveGrantId);
    expect(tasks).toHaveLength(1);
    expect(tasks![0]).toMatchObject({ kind: "remove", status: "open", reason: "leaver", connector_status: null, request_id: null });
    expect(Date.parse(tasks![0].due_at as string) - Date.parse(tasks![0].created_at as string)).toBeLessThanOrEqual(86_400_000 + 5_000);

    const { data: grants } = await db().from("access_grants").select("id, removal_status, revoked_at").in("id", [liveGrantId, pendingGrantId]);
    const byId = new Map((grants ?? []).map((g) => [g.id as string, g]));
    expect(byId.get(liveGrantId)).toMatchObject({ removal_status: "pending_removal", revoked_at: null });
    expect(byId.get(pendingGrantId)?.revoked_at).not.toBeNull();

    const { data: audit } = await db().from("audit_logs").select("metadata").eq("tenant_id", tenantId).eq("object_id", personId).eq("action", "access.leaver_removals_opened").eq("outcome", "success");
    expect(audit?.[0]?.metadata).toMatchObject({ removalGrantIds: [liveGrantId], withdrawnGrantIds: [pendingGrantId] });

    const list = await request.get("/api/v1/access/fulfilment-tasks?view=all");
    const mine = ((await list.json()).data as { accessGrantId: string; reason: string | null }[]).find((t) => t.accessGrantId === liveGrantId);
    expect(mine?.reason).toBe("leaver");

    // COMPLIANCE-P0-14 part 2: the termination SLA report shows it, open and due within a day.
    const report = await request.get("/api/v1/reports/leaver_removal_sla");
    expect(report.status(), await report.text()).toBe(200);
    const rows = (await report.json()).data.rows as { href: string; fields: Record<string, unknown> }[];
    const row = rows.find((r) => r.fields.application === `e2e-leaver-app-${stamp}`);
    expect(row?.fields).toMatchObject({ change: "remove access", outcome: "open" });
    // FOUNDATION-P0-34: the link is the identity's number URL, not its UUID.
    const { data: person } = await db().from("identities").select("ref").eq("tenant_id", tenantId).eq("id", personId).single();
    expect(row?.href).toBe(`/identities/${person?.ref}`);
  });

  test("a later step does not open the removals again", async ({ request }) => {
    const res = await request.post(`/api/v1/identities/${personId}/lifecycle`, { data: { toState: "TERMINATED", note: "Contract ended" } });
    expect(res.status(), await res.text()).toBe(201);
    const { count } = await db().from("access_fulfilment_tasks").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("application_id", applicationId);
    expect(count).toBe(1);
  });
});
