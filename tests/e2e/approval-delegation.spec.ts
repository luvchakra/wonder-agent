import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE, TEST_USERS } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * ACCESS-P0-23 — approver delegation, against the real app and database:
 * - an approver hands their approvals to a colleague until a date;
 * - the colleague then sees and decides the steps that name the approver,
 *   and the step records both who decided and on whose behalf;
 * - once ended, the delegation gives nothing;
 * - only an access manager sets one for someone else; another
 *   organization sees and ends none.
 */

const stamp = Date.now();
let tenantId = "";
let appId = "";
let entId = "";
let ent2Id = "";
let iamUser = "";
let roUser = "";
let delegationId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function promote(request: APIRequestContext, browser: Browser, id: string, ownerId: string) {
  expect((await request.patch(`/api/v1/access/applications/${id}`, { data: { businessOwnerIdentityId: ownerId, technicalOwnerIdentityId: ownerId } })).status()).toBe(200);
  const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${id}/onboarding`, { data });
  await onb({ action: "start" });
  await onb({
    action: "configure",
    config: {
      accountIdentifierField: "id",
      correlationAccountField: "email",
      correlationIdentityField: "email",
      entitlementSource: "manual",
      requestPolicy: "owner_approval",
      certificationPolicy: "annual",
      provenanceEnabled: true,
    },
  });
  await onb({ action: "validate" });
  await onb({ action: "simulate" });
  const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
  expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
  await iam.close();
  expect((await onb({ action: "promote" })).status()).toBe(200);
}

const ask = (request: APIRequestContext, why: string, entitlementId = entId) => request.post("/api/v1/access/requests", { data: { applicationId: appId, entitlementId, justification: why } });
const decide = (request: APIRequestContext, id: string) => request.post(`/api/v1/access/requests/${id}/decision`, { data: { decision: "approved", comment: "On behalf" } });
const waiting = async (request: APIRequestContext) => ((await (await request.get("/api/v1/access/requests?view=waiting")).json()).data as { id: string }[]).map((r) => r.id);

test.describe.serial("approver delegation", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: requests for this application are approved by its owner", async ({ request, browser }) => {
    test.setTimeout(120_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const user = async (email: string) => (await db().from("users").select("id").eq("email", email).single()).data!.id as string;
    iamUser = await user(TEST_USERS.iamAdminOne.email);
    roUser = await user(TEST_USERS.readOnly.email);
    // A delegation an earlier run left in force between these two would change what is expected here.
    await db().from("access_delegations").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tenantId).in("delegator_user_id", [iamUser, roUser]).is("revoked_at", null);
    const { data: owner } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", iamUser).limit(1).single();
    appId = (await (await request.post("/api/v1/access/applications", { data: { name: `E2E Delegation App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } })).json())
      .data.id;
    entId = (await (await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: `Viewer ${stamp}`, dataClassification: "internal", privilegeLevel: "standard" } })).json())
      .data.id;
    ent2Id = (await (await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: `Editor ${stamp}`, dataClassification: "internal", privilegeLevel: "standard" } })).json()).data.id;
    await promote(request, browser, appId, owner!.id as string);
    const policy = await request.post("/api/v1/access/request-policies", {
      data: { applicationId: appId, name: `E2E Delegation Policy ${stamp}`, autoApprove: false, approval: "owner_approval", riskThreshold: "high" },
    });
    expect(policy.status(), await policy.text()).toBe(200);
  });

  test("a colleague decides the owner's approvals while delegated, on their behalf", async ({ request, browser }) => {
    test.setTimeout(90_000);
    const res = await ask(request, "Quarterly report");
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).data.id as string;
    const { data: steps } = await db().from("access_request_approvals").select("approver_user_id, status").eq("request_id", id);
    expect(steps!.some((s) => s.approver_user_id === iamUser && s.status === "pending")).toBe(true);

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect(await waiting(ro.request)).not.toContain(id);
    expect((await decide(ro.request, id)).status()).toBe(403);
    // Only an access manager delegates someone else's approvals.
    expect(
      (await ro.request.post("/api/v1/access/delegations", { data: { delegatorUserId: iamUser, delegateUserId: roUser, endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() } })).status(),
    ).toBe(403);

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await iam.request.post("/api/v1/access/delegations", { data: { delegateUserId: iamUser, endsAt: new Date(Date.now() + 86_400_000).toISOString() } })).status()).toBe(400);
    const made = await iam.request.post("/api/v1/access/delegations", { data: { delegateUserId: roUser, endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), reason: "Leave" } });
    expect(made.status(), await made.text()).toBe(201);
    delegationId = (await made.json()).data.id;
    expect((await made.json()).data).toMatchObject({ active: true, delegatorUserId: iamUser, delegateUserId: roUser });
    await iam.close();

    expect(await waiting(ro.request)).toContain(id);
    const decided = await decide(ro.request, id);
    expect(decided.status(), await decided.text()).toBe(200);
    const { data: after } = await db().from("access_request_approvals").select("decided_by, decided_on_behalf_of, status").eq("request_id", id).eq("approver_user_id", iamUser).single();
    expect(after).toMatchObject({ status: "approved", decided_by: roUser, decided_on_behalf_of: iamUser });
    const { data: audit } = await db().from("audit_logs").select("metadata").eq("tenant_id", tenantId).eq("object_id", id).eq("action", "access.approval_step_approved");
    expect(audit?.[0]?.metadata).toMatchObject({ onBehalfOf: iamUser });
    await ro.close();
  });

  test("once ended, the delegation gives nothing; another organization sees and ends none", async ({ request, browser }) => {
    test.setTimeout(90_000);
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect(((await (await two.request.get("/api/v1/access/delegations")).json()).data as { id: string }[]).some((d) => d.id === delegationId)).toBe(false);
    expect((await two.request.post(`/api/v1/access/delegations/${delegationId}/revoke`)).status()).toBe(404);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    // The delegate may end it too.
    const ended = await ro.request.post(`/api/v1/access/delegations/${delegationId}/revoke`);
    expect(ended.status(), await ended.text()).toBe(200);
    const res = await ask(request, "Second report", ent2Id);
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).data.id as string;
    expect(await waiting(ro.request)).not.toContain(id);
    expect((await decide(ro.request, id)).status()).toBe(403);
    await ro.close();
  });

  test("the delegations page", async ({ page }) => {
    await page.goto("/access/requests?view=waiting");
    await page.getByRole("link", { name: "Delegate your approvals" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Delegations" })).toBeVisible();
  });
});
