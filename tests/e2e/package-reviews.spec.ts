import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * COMPLIANCE-P0-10 part 3 — owner reviews of access packages. A package
 * with two entitlements of a live application, owned by the IAM
 * administrator, is reviewed in a "package_contents" campaign: one item per
 * entitlement, sent to the owner, the elevated one marked for review.
 * Certify keeps it; revoke removes it from the package at once; an
 * exception is not offered for a package's contents.
 */

const stamp = Date.now();
let tenantId: string;
let iamId: string;
let packageId: string;
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
  const owner = (await (await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E PR Owner ${stamp}` } })).json()).data.id;
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

type ItemRow = { id: string; reviewer_id: string; package_id: string | null; package_resource_id: string | null; identity_id: string | null; agent_id: string | null; risk_at_review: string | null; snapshot: { package: { name: string; resource: { entitlementName: string | null } } } };

const decide = (ctx: APIRequestContext, id: string, decision: string) => ctx.post(`/api/v1/compliance/items/${id}/decisions`, { data: { decision, justification: "COMPLIANCE-P0-10 package review" } });

test.describe.serial("owner reviews of access packages", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: a live package with two entitlements, owned by the IAM administrator", async ({ request, browser }) => {
    test.setTimeout(180_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    iamId = (await db().from("users").select("id").eq("email", TEST_USERS.iamAdminOne.email).single()).data!.id as string;
    const { data: ownerIdentity } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", iamId).single();
    const app = await liveApp(request, browser, `E2E PR App ${stamp}`, [
      [`PR Reader ${stamp}`, "standard"],
      [`PR Writer ${stamp}`, "elevated"],
    ]);
    [readerId, writerId] = app.entitlementIds;
    const created = await request.post("/api/v1/access/packages", { data: { name: `E2E PR Package ${stamp}`, ownerIdentityId: ownerIdentity!.id } });
    expect(created.status(), await created.text()).toBe(201);
    packageId = (await created.json()).data.id as string;
    for (const entitlementId of [readerId, writerId]) {
      expect((await request.post(`/api/v1/access/packages/${packageId}/resources`, { data: { applicationId: app.id, entitlementId } })).status()).toBe(201);
    }
    expect((await request.patch(`/api/v1/access/packages/${packageId}`, { data: { status: "active" } })).status()).toBe(200);
  });

  test("a campaign has one item per resource, sent to the package's owner", async ({ request }) => {
    test.setTimeout(120_000);
    const body = { name: `E2E PR review ${stamp}`, scopeType: "package_contents", scope: { packageId }, cadence: "one_time" };
    const preview = await request.post("/api/v1/compliance/campaigns/preview", { data: body });
    expect(preview.status(), await preview.text()).toBe(200);
    expect((await preview.json()).data).toMatchObject({ items: 2, subjects: 1, privileged: 1, reviewerFallbacks: 0 });
    // A package's owner reviews it; another reviewer kind is refused.
    expect((await request.post("/api/v1/compliance/campaigns", { data: { ...body, reviewerKind: "manager" } })).status()).toBe(400);

    const res = await request.post("/api/v1/compliance/campaigns", { data: body });
    expect(res.status(), await res.text()).toBe(200);
    campaignId = (await res.json()).data.id as string;
    await expect.poll(async () => (await db().from("certification_campaigns").select("build_status").eq("id", campaignId).single()).data?.build_status, { timeout: 60_000 }).toBe("ready");
    const { data } = await db().from("certification_items").select("id, reviewer_id, package_id, package_resource_id, identity_id, agent_id, risk_at_review, snapshot").eq("tenant_id", tenantId).eq("campaign_id", campaignId);
    const items = (data ?? []) as ItemRow[];
    expect(items).toHaveLength(2);
    for (const i of items) expect(i).toMatchObject({ reviewer_id: iamId, package_id: packageId, identity_id: null, agent_id: null });
    expect(items.find((i) => i.snapshot.package.resource.entitlementName === `PR Writer ${stamp}`)!.risk_at_review).toBe("high");
  });

  test("the owner certifies one and revokes the other; the revoke removes it from the package", async ({ browser }) => {
    test.setTimeout(120_000);
    const { data } = await db().from("certification_items").select("id, snapshot").eq("tenant_id", tenantId).eq("campaign_id", campaignId);
    const items = (data ?? []) as ItemRow[];
    const reader = items.find((i) => i.snapshot.package.resource.entitlementName === `PR Reader ${stamp}`)!;
    const writer = items.find((i) => i.snapshot.package.resource.entitlementName === `PR Writer ${stamp}`)!;
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await decide(iam.request, reader.id, "exception")).status()).toBe(400);
    expect((await decide(iam.request, reader.id, "approve")).status()).toBe(200);
    const revoked = await decide(iam.request, writer.id, "revoke");
    expect(revoked.status(), await revoked.text()).toBe(200);
    await iam.close();

    const { data: left } = await db().from("access_package_resources").select("entitlement_id").eq("tenant_id", tenantId).eq("package_id", packageId);
    expect((left ?? []).map((r) => r.entitlement_id)).toEqual([readerId]);
    const { data: audit } = await db().from("audit_logs").select("action").eq("tenant_id", tenantId).eq("object_id", writer.id);
    expect((audit ?? []).map((a) => a.action)).toContain("compliance.access_revoked");
  });

  test("the campaign page names the package and what it contains", async ({ page }) => {
    await page.goto(`/compliance/campaigns/${campaignId}`);
    await expect(page.getByRole("link", { name: `E2E PR Package ${stamp}` }).first()).toBeVisible();
    await expect(page.getByText(`PR Reader ${stamp}`, { exact: false }).first()).toBeVisible();
  });

  test.afterAll(async ({ request }) => {
    if (packageId) await request.patch(`/api/v1/access/packages/${packageId}`, { data: { status: "retired" } });
  });
});
