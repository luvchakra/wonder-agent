import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * ACCESS-P0-18 — the request catalog and request policies against the real
 * app and database (spec §11.5):
 * - only items a request policy makes requestable, on live applications;
 * - a request for yourself succeeds when the policy allows; low risk under
 *   an auto-approval policy is approved at once, high risk waits;
 * - requesting for someone else needs the scope (manager or access
 *   manager); a missing justification and too long a duration are refused;
 * - an identical open request is returned, not duplicated;
 * - the requester can cancel; nobody approves their own request.
 * Other organizations and read-only roles see and change nothing.
 */

const stamp = Date.now();
let appId = "";
let readerId = "";
let adminEntId = "";

async function registerApp(request: APIRequestContext, name: string) {
  const res = await request.post("/api/v1/access/applications", { data: { name, appType: "saas", riskLevel: "low", dataClassification: "internal" } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id as string;
}

/** Makes an application live through the real onboarding flow (ACCESS-P0-16). */
async function promote(request: APIRequestContext, browser: Browser, id: string) {
  const owner = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Req Owner ${stamp}-${id.slice(0, 4)}` } });
  const ownerId = (await owner.json()).data.id;
  expect((await request.patch(`/api/v1/access/applications/${id}`, { data: { businessOwnerIdentityId: ownerId, technicalOwnerIdentityId: ownerId } })).status()).toBe(200);
  const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${id}/onboarding`, { data });
  await onb({ action: "start" });
  await onb({
    action: "configure",
    config: { accountIdentifierField: "id", correlationAccountField: "email", correlationIdentityField: "email", entitlementSource: "manual", requestPolicy: "manager_approval", certificationPolicy: "annual", provenanceEnabled: true },
  });
  expect((await (await onb({ action: "validate" })).json()).data.status).toBe("VALIDATING");
  expect((await (await onb({ action: "simulate" })).json()).data.status).toBe("WAITING_FOR_APPROVAL");
  const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
  expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
  await iam.close();
  expect((await onb({ action: "promote" })).status()).toBe(200);
}

const submit = (request: APIRequestContext, data: Record<string, unknown>) => request.post("/api/v1/access/requests", { data });

test.describe.serial("request catalog", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: a live application with a standard and an admin entitlement, under request policies", async ({ request, browser }) => {
    test.setTimeout(120_000);
    appId = await registerApp(request, `E2E Req App ${stamp}`);
    const reader = await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: "Reader", dataClassification: "internal", privilegeLevel: "standard" } });
    readerId = (await reader.json()).data.id;
    const admin = await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: "Administrator", dataClassification: "internal", privilegeLevel: "admin" } });
    adminEntId = (await admin.json()).data.id;
    // A second application that never goes live: it must never appear in the catalog.
    await registerApp(request, `E2E Req Bare ${stamp}`);

    // Not live yet: refused even before any policy exists.
    expect((await submit(request, { applicationId: appId, entitlementId: readerId, justification: "Monthly close reporting" })).status()).toBe(409);
    await promote(request, browser, appId);
    // Live, but no policy covers it: not requestable.
    const none = await submit(request, { applicationId: appId, entitlementId: readerId, justification: "Monthly close reporting" });
    expect(none.status()).toBe(403);

    expect((await request.post("/api/v1/access/request-policies", { data: { applicationId: appId, name: "x", riskThreshold: "extreme" } })).status()).toBe(400);
    const policy = await request.post("/api/v1/access/request-policies", {
      data: { applicationId: appId, name: `E2E Req Policy ${stamp}`, autoApprove: true, riskThreshold: "high", maxDurationDays: 90, defaultDurationDays: 30, justificationRequired: true, allowForOthers: "managers" },
    });
    expect(policy.status(), await policy.text()).toBe(200);
    // Saving the same scope again updates it rather than adding a second policy.
    const again = await request.post("/api/v1/access/request-policies", { data: { applicationId: appId, name: `E2E Req Policy ${stamp}`, approval: "manager_and_owner" } });
    expect((await again.json()).data.id).toBe((await policy.json()).data.id);
  });

  test("the catalog lists the live application with each entitlement's risk and approval", async ({ request }) => {
    const res = await request.get(`/api/v1/access/catalog?q=${encodeURIComponent(`E2E Req App ${stamp}`)}`);
    const items = (await res.json()).data as { applicationId: string; entitlements: { id: string; risk: string; approval: string | null }[] }[];
    const item = items.find((i) => i.applicationId === appId)!;
    expect(item.entitlements.find((e) => e.id === readerId)).toMatchObject({ risk: "low", approval: "automatic" });
    expect(item.entitlements.find((e) => e.id === adminEntId)).toMatchObject({ risk: "critical", approval: "manager_and_owner" });
    const bare = (await (await request.get(`/api/v1/access/catalog?q=${encodeURIComponent(`E2E Req Bare ${stamp}`)}`)).json()).data;
    expect(bare).toEqual([]);
    // Requestable only (the screen's default): this application is in; a live one no policy covers is not.
    const only = (await (await request.get(`/api/v1/access/catalog?requestable=1&q=${encodeURIComponent(`E2E Req App ${stamp}`)}`)).json()).data as { applicationId: string }[];
    expect(only.map((i) => i.applicationId)).toEqual([appId]);
    const everyLive = (await (await request.get("/api/v1/access/catalog?requestable=1&q=E2E%20Acc%20App")).json()).data as { requestable: boolean }[];
    expect(everyLive.every((i) => i.requestable)).toBe(true);
  });

  test("for yourself: low risk is approved at once; an identical request returns the open one; bad input is refused", async ({ request }) => {
    expect((await submit(request, { applicationId: appId, entitlementId: readerId, justification: "short" })).status()).toBe(400);
    expect((await submit(request, { applicationId: appId, entitlementId: readerId, justification: "Monthly close reporting", durationDays: 120 })).status()).toBe(400);
    const res = await submit(request, { applicationId: appId, entitlementId: readerId, justification: "Monthly close reporting" });
    expect(res.status(), await res.text()).toBe(201);
    const r = (await res.json()).data;
    expect(r).toMatchObject({ status: "approved", riskLevel: "low", durationDays: 30, agentId: null });
    expect(r.requestedExpiry).toBeTruthy();
    const dup = await submit(request, { applicationId: appId, entitlementId: readerId, justification: "Monthly close reporting again" });
    expect(dup.status()).toBe(200);
    expect((await dup.json()).meta.duplicate).toBe(true);
    expect((await dup.json()).data.id).toBe(r.id);
  });

  test("high risk waits for someone else to approve; the requester cannot", async ({ request, browser }) => {
    const res = await submit(request, { applicationId: appId, entitlementId: adminEntId, justification: "Break-glass for the audit week", durationDays: 7 });
    const r = (await res.json()).data;
    expect(r).toMatchObject({ status: "pending", riskLevel: "critical", durationDays: 7 });
    const self = await request.post(`/api/v1/access/requests/${r.id}/decision`, { data: { decision: "approved" } });
    expect(self.status()).toBe(409);
    expect((await self.json()).error.code).toBe("SELF_APPROVAL");
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const ok = await iam.request.post(`/api/v1/access/requests/${r.id}/decision`, { data: { decision: "approved" } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await iam.request.post(`/api/v1/access/requests/${r.id}/decision`, { data: { decision: "rejected" } })).status()).toBe(409);
    await iam.close();
  });

  test("for someone else: an access manager may; a requester who is not their manager may not; the requester cancels their own", async ({ request, browser }) => {
    const person = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Req Person ${stamp}` } });
    const personId = (await person.json()).data.id;
    const forThem = await submit(request, { applicationId: appId, entitlementId: readerId, subjectIdentityId: personId, justification: "Joining the close team" });
    expect(forThem.status(), await forThem.text()).toBe(201);

    const req = await browser.newContext({ storageState: authFile("requester") });
    const refused = await submit(req.request, { applicationId: appId, entitlementId: adminEntId, subjectIdentityId: personId, justification: "Please give them admin" });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error.code).toBe("REQUEST_SCOPE");
    const own = await submit(req.request, { applicationId: appId, entitlementId: adminEntId, justification: "Need admin for the migration" });
    expect(own.status(), await own.text()).toBe(201);
    const ownId = (await own.json()).data.id;
    expect((await request.post(`/api/v1/access/requests/${ownId}/cancel`)).status()).toBe(403);
    expect((await req.request.post(`/api/v1/access/requests/${ownId}/cancel`)).status()).toBe(200);
    expect((await req.request.post(`/api/v1/access/requests/${ownId}/cancel`)).status()).toBe(409);
    const mine = (await (await req.request.get("/api/v1/access/requests?mine=1")).json()).data as { id: string; status: string }[];
    expect(mine.find((m) => m.id === ownId)?.status).toBe("cancelled");
    await req.close();
  });

  test("the catalog and request screens", async ({ page }) => {
    await page.goto(`/access/catalog?q=${encodeURIComponent(`E2E Req App ${stamp}`)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Request access" })).toBeVisible();
    await expect(page.getByText("Approved automatically").first()).toBeVisible();
    await page.getByRole("link", { name: "Reader" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Request E2E Req App ${stamp}` })).toBeVisible();
    await page.getByRole("textbox", { name: /Why you need it/ }).fill("Monthly close reporting from the screen");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText(/An identical request is already open/)).toBeVisible();

    await page.goto("/access/requests?view=mine");
    await expect(page.getByRole("heading", { level: 1, name: "Access Requests" })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(`E2E Req App ${stamp}`) }).first()).toBeVisible();

    await page.goto("/access/request-policies");
    await expect(page.getByRole("row", { name: new RegExp(`E2E Req Policy ${stamp}`) })).toBeVisible();
  });

  test("another organization sees and changes none of it; read-only can neither request nor set policy", async ({ browser }) => {
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await submit(two.request, { applicationId: appId, entitlementId: readerId, justification: "Cross-tenant attempt here" })).status()).toBe(404);
    expect((await (await two.request.get(`/api/v1/access/catalog?q=${encodeURIComponent(`E2E Req App ${stamp}`)}`)).json()).data).toEqual([]);
    const policies = (await (await two.request.get("/api/v1/access/request-policies")).json()).data as { applicationId: string | null }[];
    expect(policies.some((p) => p.applicationId === appId)).toBe(false);
    expect((await two.request.post("/api/v1/access/request-policies", { data: { applicationId: appId, name: "hijack" } })).status()).toBe(404);
    const all = (await (await two.request.get("/api/v1/access/requests?view=all")).json()).data as { applicationId: string }[];
    expect(all.some((r) => r.applicationId === appId)).toBe(false);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await submit(ro.request, { applicationId: appId, entitlementId: readerId, justification: "Read-only attempt here" })).status()).toBe(403);
    expect((await ro.request.post("/api/v1/access/request-policies", { data: { name: "x" } })).status()).toBe(403);
    await ro.close();
  });
});
