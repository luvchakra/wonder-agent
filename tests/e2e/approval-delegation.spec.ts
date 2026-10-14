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
let ent3Id = "";
let requesterUser = "";
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
    requesterUser = await user(TEST_USERS.requester.email);
    // A delegation an earlier run left in force between these two would change what is expected here.
    await db().from("access_delegations").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tenantId).in("delegator_user_id", [iamUser, roUser]).is("revoked_at", null);
    await db().from("access_delegations").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("delegate_user_id", requesterUser).is("revoked_at", null);
    const { data: owner } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", iamUser).limit(1).single();
    appId = (await (await request.post("/api/v1/access/applications", { data: { name: `E2E Delegation App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } })).json())
      .data.id;
    entId = (await (await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: `Viewer ${stamp}`, dataClassification: "internal", privilegeLevel: "standard" } })).json())
      .data.id;
    ent2Id = (await (await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: `Editor ${stamp}`, dataClassification: "internal", privilegeLevel: "standard" } })).json()).data.id;
    ent3Id = (await (await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: `Reader ${stamp}`, dataClassification: "internal", privilegeLevel: "standard" } })).json()).data.id;
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

  test("part 2: a delegate asks for access on the person's behalf; neither of them approves it", async ({ request, browser }) => {
    test.setTimeout(90_000);
    const asker = await browser.newContext({ storageState: authFile("requester") });
    const ask3 = (onBehalfOf: string) => asker.request.post("/api/v1/access/requests", { data: { applicationId: appId, entitlementId: ent3Id, justification: "While they are away", onBehalfOf } });
    // No delegation: refused.
    const refused = await ask3(iamUser);
    expect(refused.status(), await refused.text()).toBe(403);
    expect((await refused.json()).error.code).toBe("NO_DELEGATION");

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const made = await iam.request.post("/api/v1/access/delegations", { data: { delegateUserId: requesterUser, scope: "requests", endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() } });
    expect(made.status(), await made.text()).toBe(201);
    expect((await made.json()).data).toMatchObject({ scope: "requests", delegatorUserId: iamUser });

    const res = await ask3(iamUser);
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).data.id as string;
    const { data: row } = await db().from("access_requests").select("requested_by, requested_on_behalf_of, subject_identity_id").eq("id", id).single();
    const { data: iamIdentity } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", iamUser).limit(1).single();
    expect(row).toMatchObject({ requested_by: requesterUser, requested_on_behalf_of: iamUser, subject_identity_id: iamIdentity!.id });
    // The owner's step goes to access managers: the owner asked for it through a delegate.
    const { data: steps } = await db().from("access_request_approvals").select("approver_kind, reason").eq("request_id", id);
    expect(steps!.every((s) => s.approver_kind === "access_managers")).toBe(true);
    expect((await iam.request.post(`/api/v1/access/requests/${id}/decision`, { data: { decision: "approved", comment: "mine" } })).status()).toBe(409);
    const decided = await decide(request, id);
    expect(decided.status(), await decided.text()).toBe(200);
    const { data: audit } = await db().from("audit_logs").select("metadata").eq("tenant_id", tenantId).eq("object_id", id).in("action", ["access.request_submitted", "access.request_auto_approved"]);
    expect(audit?.[0]?.metadata).toMatchObject({ onBehalfOf: iamUser });

    await iam.request.post(`/api/v1/access/delegations/${(await made.json()).data.id}/revoke`);
    expect((await ask3(iamUser)).status()).toBe(403);
    await iam.close();
    await asker.close();
  });

  test("part 3: administration delegation gives the delegate copies of the person's roles until it ends", async ({ request, browser }) => {
    test.setTimeout(90_000);
    // Copies an interrupted run left behind would read as roles already held.
    await db().from("user_roles").delete().eq("tenant_id", tenantId).eq("user_id", roUser).not("delegation_id", "is", null);
    const until = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    const asManager = () => ro.request.post("/api/v1/access/delegations", { data: { delegatorUserId: iamUser, delegateUserId: requesterUser, endsAt: until } });
    expect((await asManager()).status()).toBe(403);

    // Only someone who manages roles sets one up.
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await iam.request.post("/api/v1/access/delegations", { data: { delegateUserId: roUser, scope: "administration", endsAt: until } })).status()).toBe(403);
    await iam.close();
    // Tenant Administrator is never delegated: with nothing else to give, nothing is made.
    const nothing = await request.post("/api/v1/access/delegations", { data: { delegateUserId: roUser, scope: "administration", endsAt: until } });
    expect(nothing.status(), await nothing.text()).toBe(409);
    expect((await nothing.json()).error.code).toBe("NOTHING_TO_DELEGATE");

    const made = await request.post("/api/v1/access/delegations", { data: { delegatorUserId: iamUser, delegateUserId: roUser, scope: "administration", endsAt: until, reason: "Leave" } });
    expect(made.status(), await made.text()).toBe(201);
    const delegation = (await made.json()).data as { id: string; scope: string; roles: { granted: string[] } };
    expect(delegation).toMatchObject({ scope: "administration", roles: { granted: ["IAM_ADMIN"] } });
    const copies = async () => (await db().from("user_roles").select("expires_at, roles(name)").eq("tenant_id", tenantId).eq("user_id", roUser).eq("delegation_id", delegation.id)).data ?? [];
    const [copy] = await copies();
    expect((copy.roles as unknown as { name: string }).name).toBe("IAM_ADMIN");
    expect(Date.parse(copy.expires_at as string)).toBe(Date.parse(until));

    // The delegate now holds the person's rights: managing access for someone else works.
    const asDelegate = await asManager();
    expect(asDelegate.status(), await asDelegate.text()).toBe(201);
    await ro.request.post(`/api/v1/access/delegations/${(await asDelegate.json()).data.id}/revoke`);

    // Ended early: the copies go at once, and so do the rights.
    expect((await request.post(`/api/v1/access/delegations/${delegation.id}/revoke`)).status()).toBe(200);
    expect(await copies()).toEqual([]);
    expect((await asManager()).status()).toBe(403);
    await ro.close();
  });

  test("the delegations page", async ({ page }) => {
    await page.goto("/access/requests?view=waiting");
    await page.getByRole("link", { name: "Delegate your approvals" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Delegations" })).toBeVisible();
  });
});
