import { test, expect, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authFile, TENANT_TWO } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * ACCESS-P0-35 part 1 — approved changes to request policies (owner
 * decision: only where two or more Tenant Administrators exist). Tenant Two
 * has two (adminTwo and the multi-organization member), so a change waits
 * for the other one: proposed, not applied; never decided by its proposer;
 * approved, it applies as a numbered version; rejected, nothing changes.
 * Tenant One (one administrator) keeps saving at once, and sees none of
 * Tenant Two's changes.
 */

const stamp = Date.now();
let tenantTwoId = "";
let appId = "";
let changeId = "";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

/** The multi-organization member, working in Tenant Two. */
async function otherAdmin(browser: Browser) {
  const ctx = await browser.newContext({ storageState: authFile("multiOrg") });
  await ctx.addCookies([{ name: "wa_tenant", value: tenantTwoId, url: process.env.E2E_BASE_URL ?? "http://localhost:3000" }]);
  return ctx;
}

test.describe.serial("approved request policy changes", () => {
  test.use({ storageState: authFile("adminTwo") });

  test("a change waits for another administrator, who cannot be its proposer", async ({ request, page }) => {
    tenantTwoId = await getTenantIdBySlug(TENANT_TWO.slug);
    const app = await request.post("/api/v1/access/applications", { data: { name: `E2E Four Eyes App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } });
    expect(app.status(), await app.text()).toBe(201);
    appId = (await app.json()).data.id;

    const proposed = await request.post("/api/v1/access/request-policies", { data: { applicationId: appId, name: `E2E Four Eyes ${stamp}`, autoApprove: false, maxDurationDays: 30 } });
    expect(proposed.status(), await proposed.text()).toBe(202);
    const change = (await proposed.json()).data.pendingChange as { id: string; changes: { field: string; after: unknown }[] };
    changeId = change.id;
    expect(change.changes.find((c) => c.field === "name")?.after).toBe(`E2E Four Eyes ${stamp}`);

    // Not applied yet, and a second proposal for the same policy waits its turn.
    const policies = (await (await request.get("/api/v1/access/request-policies")).json()).data as { applicationId: string | null }[];
    expect(policies.some((p) => p.applicationId === appId)).toBe(false);
    const again = await request.post("/api/v1/access/request-policies", { data: { applicationId: appId, name: "Another" } });
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe("CHANGE_PENDING");

    const own = await request.post(`/api/v1/access/governance-changes/${changeId}/decision`, { data: { decision: "approved" } });
    expect(own.status()).toBe(409);
    expect((await own.json()).error.code).toBe("SELF_APPROVAL");

    await page.goto("/access/request-policies");
    await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
    await expect(page.getByText("Waiting for another administrator").first()).toBeVisible();
  });

  test("approved by the other administrator, it applies as version 1; a rejected change leaves it as it was", async ({ request, browser }) => {
    const other = await otherAdmin(browser);
    const listed = (await (await other.request.get("/api/v1/access/governance-changes")).json()).data as { id: string }[];
    expect(listed.map((c) => c.id)).toContain(changeId);
    const approved = await other.request.post(`/api/v1/access/governance-changes/${changeId}/decision`, { data: { decision: "approved", note: "Looks right" } });
    expect(approved.status(), await approved.text()).toBe(200);
    expect((await approved.json()).data).toMatchObject({ status: "approved" });

    const policy = ((await (await request.get("/api/v1/access/request-policies")).json()).data as { id: string; applicationId: string | null; maxDurationDays: number | null }[]).find((p) => p.applicationId === appId)!;
    expect(policy.maxDurationDays).toBe(30);
    const { data: versions } = await db().from("governance_object_versions").select("version, change_id, approved_by").eq("tenant_id", tenantTwoId).eq("object_id", policy.id);
    expect(versions).toHaveLength(1);
    expect(versions![0]).toMatchObject({ version: 1, change_id: changeId });
    expect(versions![0].approved_by).toBeTruthy();

    const next = await request.post("/api/v1/access/request-policies", { data: { applicationId: appId, maxDurationDays: 10 } });
    expect(next.status()).toBe(202);
    const rejected = await other.request.post(`/api/v1/access/governance-changes/${(await next.json()).data.pendingChange.id}/decision`, { data: { decision: "rejected" } });
    expect(rejected.status()).toBe(200);
    const after = ((await (await request.get("/api/v1/access/request-policies")).json()).data as { applicationId: string | null; maxDurationDays: number | null }[]).find((p) => p.applicationId === appId)!;
    expect(after.maxDurationDays).toBe(30);
    await other.close();
  });

  test("another organization sees and decides none of these changes; a member who does not manage access sees none", async ({ browser }) => {
    const one = await browser.newContext({ storageState: authFile("adminOne") });
    const listed = (await (await one.request.get("/api/v1/access/governance-changes?status=all")).json()).data as { id: string }[];
    expect(listed.map((c) => c.id)).not.toContain(changeId);
    expect((await one.request.post(`/api/v1/access/governance-changes/${changeId}/decision`, { data: { decision: "rejected" } })).status()).toBe(404);
    await one.close();
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get("/api/v1/access/governance-changes")).status()).toBe(403);
    await ro.close();
  });
});
