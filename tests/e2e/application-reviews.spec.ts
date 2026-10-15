import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * COMPLIANCE-P0-10 part 4 — owner reviews of applications. A live
 * application with two entitlements is reviewed in an "application_contents"
 * campaign: one item per entitlement. The elevated one has an entitlement
 * owner (the IAM administrator), who reviews it; the other falls to the
 * application's business owner, who cannot sign in here, so to the named
 * reviewer. Certify keeps an entitlement; revoke disables it (nobody can
 * request it) without touching anyone's access; no exception is offered.
 */

const stamp = Date.now();
let tenantId: string;
let iamId: string;
let applicationId: string;
let readerId: string;
let writerId: string;
let campaignId: string;

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** A live application: registered, its entitlements listed, onboarded and promoted (as in access-packages.spec.ts). */
async function liveApp(request: APIRequestContext, browser: Browser, name: string, entitlements: [string, string][]): Promise<{ id: string; entitlementIds: string[] }> {
  const id = (await (await request.post("/api/v1/access/applications", { data: { name, appType: "saas", riskLevel: "low", dataClassification: "internal" } })).json()).data.id as string;
  const entitlementIds: string[] = [];
  for (const [entName, privilegeLevel] of entitlements) {
    const res = await request.post(`/api/v1/access/applications/${id}/entitlements`, { data: { name: entName, dataClassification: "internal", privilegeLevel } });
    expect(res.status(), await res.text()).toBe(201);
    entitlementIds.push((await res.json()).data.id as string);
  }
  const owner = (await (await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E AR Owner ${stamp}` } })).json()).data.id;
  expect((await request.patch(`/api/v1/access/applications/${id}`, { data: { businessOwnerIdentityId: owner, technicalOwnerIdentityId: owner } })).status()).toBe(200);
  const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${id}/onboarding`, { data });
  await onb({ action: "start" });
  await onb({
    action: "configure",
    config: { accountIdentifierField: "id", correlationAccountField: "email", correlationIdentityField: "email", entitlementSource: "manual", requestPolicy: "manager_approval", certificationPolicy: "annual", provenanceEnabled: true },
  });
  await onb({ action: "validate" });
  await onb({ action: "simulate" });
  const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
  expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
  await iam.close();
  expect((await onb({ action: "promote" })).status()).toBe(200);
  return { id, entitlementIds };
}

type ItemRow = { id: string; reviewer_id: string; entitlement_id: string | null; identity_id: string | null; agent_id: string | null; risk_at_review: string | null; snapshot: { catalogEntitlement: { name: string; owner: string } } };

const decide = (ctx: APIRequestContext, id: string, decision: string) => ctx.post(`/api/v1/compliance/items/${id}/decisions`, { data: { decision, justification: "COMPLIANCE-P0-10 application review" } });

test.describe.serial("owner reviews of applications", () => {
  test.use({ storageState: authFile("adminOne") });
  let adminId: string;

  test("setup: a live application; its elevated entitlement owned by the IAM administrator", async ({ request, browser }) => {
    test.setTimeout(180_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    iamId = (await db().from("users").select("id").eq("email", TEST_USERS.iamAdminOne.email).single()).data!.id as string;
    adminId = (await db().from("users").select("id").eq("email", TEST_USERS.adminOne.email).single()).data!.id as string;
    const { data: ownerIdentity } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", iamId).single();
    const app = await liveApp(request, browser, `E2E AR App ${stamp}`, [
      [`AR Reader ${stamp}`, "standard"],
      [`AR Writer ${stamp}`, "elevated"],
    ]);
    applicationId = app.id;
    [readerId, writerId] = app.entitlementIds;
    const owned = await request.put(`/api/v1/access/entitlements/${writerId}/owner`, { data: { ownerIdentityId: ownerIdentity!.id } });
    expect(owned.status(), await owned.text()).toBe(200);
  });

  test("a campaign has one item per entitlement: the entitlement's owner, else the application's, else the named reviewer", async ({ request }) => {
    test.setTimeout(120_000);
    const body = { name: `E2E AR review ${stamp}`, scopeType: "application_contents", scope: { applicationId }, cadence: "one_time" };
    const preview = await request.post("/api/v1/compliance/campaigns/preview", { data: body });
    expect(preview.status(), await preview.text()).toBe(200);
    expect((await preview.json()).data).toMatchObject({ items: 2, subjects: 2, privileged: 1, reviewerFallbacks: 1 });
    // The owners review it; another reviewer kind is refused.
    expect((await request.post("/api/v1/compliance/campaigns", { data: { ...body, reviewerKind: "manager" } })).status()).toBe(400);

    const res = await request.post("/api/v1/compliance/campaigns", { data: body });
    expect(res.status(), await res.text()).toBe(200);
    campaignId = (await res.json()).data.id as string;
    await expect.poll(async () => (await db().from("certification_campaigns").select("build_status").eq("id", campaignId).single()).data?.build_status, { timeout: 60_000 }).toBe("ready");
    const { data } = await db().from("certification_items").select("id, reviewer_id, entitlement_id, identity_id, agent_id, risk_at_review, snapshot").eq("tenant_id", tenantId).eq("campaign_id", campaignId);
    const items = (data ?? []) as ItemRow[];
    expect(items).toHaveLength(2);
    const writer = items.find((i) => i.entitlement_id === writerId)!;
    const reader = items.find((i) => i.entitlement_id === readerId)!;
    expect(writer).toMatchObject({ reviewer_id: iamId, risk_at_review: "high", identity_id: null, agent_id: null });
    expect(writer.snapshot.catalogEntitlement.owner).toBe("entitlement_owner");
    expect(reader).toMatchObject({ reviewer_id: adminId, identity_id: null, agent_id: null });
    expect(reader.snapshot.catalogEntitlement.owner).toBe("named");
  });

  test("certify keeps one; revoke disables the other, and only its reviewer may decide", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const { data } = await db().from("certification_items").select("id, entitlement_id").eq("tenant_id", tenantId).eq("campaign_id", campaignId);
    const items = (data ?? []) as ItemRow[];
    const reader = items.find((i) => i.entitlement_id === readerId)!;
    const writer = items.find((i) => i.entitlement_id === writerId)!;
    expect((await decide(request, reader.id, "exception")).status()).toBe(400);
    expect((await decide(request, reader.id, "approve")).status()).toBe(200);
    // The writer is the IAM administrator's to decide, not the launcher's.
    expect((await decide(request, writer.id, "revoke")).status()).toBe(403);
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const revoked = await decide(iam.request, writer.id, "revoke");
    expect(revoked.status(), await revoked.text()).toBe(200);
    await iam.close();

    const { data: ents } = await db().from("entitlements").select("id, status").eq("tenant_id", tenantId).in("id", [readerId, writerId]);
    const status = new Map((ents ?? []).map((e) => [e.id as string, e.status as string]));
    expect(status.get(readerId)).toBe("active");
    expect(status.get(writerId)).toBe("inactive");
    const { data: audit } = await db().from("audit_logs").select("action").eq("tenant_id", tenantId).eq("object_id", writer.id);
    expect((audit ?? []).map((a) => a.action)).toContain("compliance.access_revoked");
  });

  test("the campaign page names the application and the entitlement", async ({ page }) => {
    await page.goto(`/compliance/campaigns/${campaignId}`);
    await expect(page.getByRole("link", { name: `E2E AR App ${stamp}` }).first()).toBeVisible();
    await expect(page.getByText(`AR Reader ${stamp}`, { exact: false }).first()).toBeVisible();
  });
});
