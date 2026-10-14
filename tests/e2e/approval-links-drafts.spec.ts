import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS } from "./support/testUsers";

/**
 * ACCESS-P0-38 part 2 — approve from a message, and saved drafts, against
 * the real app and database:
 * - when a request waits for approval, its approvers are notified with a
 *   link of their own (only the token's hash is stored);
 * - the link works once, for that approver, while signed in; it decides
 *   nothing by itself; anyone else, or a second opening, is told so;
 * - a member saves, changes and deletes their own drafts; another member or
 *   organization cannot see or touch them; read-only cannot keep any.
 */

const stamp = Date.now();
let appId = "";
let adminEntId = "";
let requestId = "";
let token = "";
let draftId = "";

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
      requestPolicy: "manager_approval",
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

test.describe.serial("approval links and request drafts", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a request waiting for approval notifies its approvers with a link of their own", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const app = await request.post("/api/v1/access/applications", { data: { name: `E2E Link App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } });
    appId = (await app.json()).data.id;
    adminEntId = (await (await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: `Admin ${stamp}`, dataClassification: "internal", privilegeLevel: "admin" } })).json())
      .data.id;
    const owner = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Link Owner ${stamp}` } });
    await promote(request, browser, appId, (await owner.json()).data.id);
    expect((await request.post("/api/v1/access/request-policies", { data: { applicationId: appId, name: `E2E Link Policy ${stamp}`, autoApprove: false, riskThreshold: "high" } })).status()).toBe(200);

    const res = await request.post("/api/v1/access/requests", { data: { applicationId: appId, entitlementId: adminEntId, justification: "Audit week", durationDays: 7 } });
    expect(res.status(), await res.text()).toBe(201);
    requestId = (await res.json()).data.id;
    expect((await res.json()).data.status).toBe("pending");

    const { data: iamUser } = await db().from("users").select("id").eq("email", TEST_USERS.iamAdminOne.email).single();
    // The notification is sent after the response; give it a moment.
    await expect
      .poll(
        async () => {
          const { data } = await db().from("notifications").select("body").eq("user_id", iamUser!.id).eq("reference_id", requestId).eq("type", "approval_required");
          return data?.[0]?.body ?? "";
        },
        { timeout: 15_000 },
      )
      .toContain(`/access/requests/${requestId}?link=`);
    const { data: notes } = await db().from("notifications").select("body").eq("user_id", iamUser!.id).eq("reference_id", requestId);
    token = /link=([A-Za-z0-9_-]{43})/.exec(notes![0].body as string)![1];
    // Only the hash is kept.
    const { data: links } = await db().from("access_approval_links").select("token_hash, user_id, used_at").eq("request_id", requestId);
    expect(links!.some((l) => l.user_id === iamUser!.id && l.used_at === null)).toBe(true);
    expect(links!.every((l) => l.token_hash !== token)).toBe(true);
    // The requester is never asked to approve their own request.
    const { data: me } = await db().from("users").select("id").eq("email", TEST_USERS.adminOne.email).single();
    expect(links!.some((l) => l.user_id === me!.id)).toBe(false);
  });

  test("the link works once, for its approver; others are told it is not theirs", async ({ browser }) => {
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    const roPage = await ro.newPage();
    await roPage.goto(`/access/requests/${requestId}?link=${token}`);
    await expect(roPage.getByText("That approval link was sent to someone else.")).toBeVisible();
    await ro.close();

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const page = await iam.newPage();
    await page.goto(`/access/requests/${requestId}?link=${token}`);
    await expect(page.getByText("Opened from your approval message. Decide below.")).toBeVisible();
    // Opening it decided nothing.
    const { data: req } = await db().from("access_requests").select("status").eq("id", requestId).single();
    expect(req!.status).toBe("pending");
    await page.goto(`/access/requests/${requestId}?link=${token}`);
    await expect(page.getByText("That approval link was already used.", { exact: false })).toBeVisible();
    await page.goto(`/access/requests/${requestId}?link=not-a-token`);
    await expect(page.getByText("That approval link is not valid.")).toBeVisible();
    await iam.close();
  });

  test("drafts are the member's own", async ({ request, browser }) => {
    const saved = await request.post("/api/v1/access/requests/drafts", {
      data: { name: `Team ${stamp}`, payload: { subjectIdentityIds: [], items: [`${appId}|${adminEntId}`], justification: "later" } },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    draftId = (await saved.json()).data.id;
    expect((await request.post("/api/v1/access/requests/drafts", { data: { name: "", payload: {} } })).status()).toBe(400);
    expect((await request.put(`/api/v1/access/requests/drafts/${draftId}`, { data: { name: `Team ${stamp} v2`, payload: { items: [] } } })).status()).toBe(200);
    const mine = (await (await request.get("/api/v1/access/requests/drafts")).json()).data as { id: string; name: string }[];
    expect(mine.find((d) => d.id === draftId)?.name).toBe(`Team ${stamp} v2`);

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect(((await (await iam.request.get("/api/v1/access/requests/drafts")).json()).data as { id: string }[]).some((d) => d.id === draftId)).toBe(false);
    expect((await iam.request.delete(`/api/v1/access/requests/drafts/${draftId}`)).status()).toBe(404);
    await iam.close();
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.put(`/api/v1/access/requests/drafts/${draftId}`, { data: { name: "forged", payload: {} } })).status()).toBe(404);
    await two.close();
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.post("/api/v1/access/requests/drafts", { data: { name: "x", payload: {} } })).status()).toBe(403);
    await ro.close();

    expect((await request.delete(`/api/v1/access/requests/drafts/${draftId}`)).status()).toBe(200);
    expect((await request.delete(`/api/v1/access/requests/drafts/${draftId}`)).status()).toBe(404);
  });
});
