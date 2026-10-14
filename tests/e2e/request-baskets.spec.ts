import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * ACCESS-P0-38 — request baskets and model-after, against the real app and
 * database:
 * - model-after proposes the model's requestable access the person lacks,
 *   and says why the rest is left out;
 * - a basket for several people and items makes one request per person and
 *   item, each checked like a single request: a refusal is reported on its
 *   own line, an identical open request is returned, not duplicated;
 * - the basket's requests share its id;
 * - another organization's people cannot be in a basket; read-only cannot send one.
 */

const stamp = Date.now();
let tenantId = "";
let appId = "";
let readerId = "";
let writerId = "";
let adminEntId = "";
let personX = "";
let personY = "";
let personZ = "";
let basketId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function person(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `${name} ${stamp}` } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id as string;
}

/** Makes an application live through the real onboarding flow (ACCESS-P0-16). */
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
  expect((await (await onb({ action: "validate" })).json()).data.status).toBe("VALIDATING");
  expect((await (await onb({ action: "simulate" })).json()).data.status).toBe("WAITING_FOR_APPROVAL");
  const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
  expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
  await iam.close();
  expect((await onb({ action: "promote" })).status()).toBe(200);
}

test.describe.serial("request baskets and model-after", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: a live application under a policy; one person holds access, another holds part of it", async ({ request, browser }) => {
    test.setTimeout(120_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const app = await request.post("/api/v1/access/applications", { data: { name: `E2E Basket App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } });
    appId = (await app.json()).data.id;
    const ent = async (name: string) =>
      (await (await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name, dataClassification: "internal", privilegeLevel: "standard" } })).json()).data.id as string;
    readerId = await ent(`Reader ${stamp}`);
    writerId = await ent(`Writer ${stamp}`);
    adminEntId = await ent(`Admin ${stamp}`);
    expect((await request.patch(`/api/v1/access/entitlements/${adminEntId}/governance`, { data: { requestable: false } })).status()).toBe(200);
    personX = await person(request, "E2E Basket X");
    personY = await person(request, "E2E Basket Y");
    personZ = await person(request, "E2E Basket Z");
    await promote(request, browser, appId, personY);
    const policy = await request.post("/api/v1/access/request-policies", {
      data: { applicationId: appId, name: `E2E Basket Policy ${stamp}`, autoApprove: true, riskThreshold: "high", allowForOthers: "managers" },
    });
    expect(policy.status(), await policy.text()).toBe(200);

    const account = async (identityId: string) => {
      const { data, error } = await db()
        .from("accounts")
        .insert({ tenant_id: tenantId, application_id: appId, identity_id: identityId, external_account_ref: `basket-${identityId.slice(0, 8)}-${stamp}` })
        .select("id")
        .single();
      expect(error, error?.message).toBeNull();
      return data!.id as string;
    };
    const grant = async (accountId: string, entitlementId: string) => {
      const { error } = await db().from("access_grants").insert({ tenant_id: tenantId, account_id: accountId, entitlement_id: entitlementId, grant_type: "direct" });
      expect(error, error?.message).toBeNull();
    };
    const y = await account(personY);
    await grant(y, readerId);
    await grant(y, writerId);
    await grant(y, adminEntId);
    await grant(await account(personX), writerId);
  });

  test("model-after: the model's requestable access the person lacks, and why the rest is left out", async ({ request }) => {
    const res = await request.get(`/api/v1/access/requests/model-after?subject=${personX}&model=${personY}`);
    expect(res.status(), await res.text()).toBe(200);
    const data = (await res.json()).data as { lines: { entitlementId: string }[]; skipped: { entitlementId: string; reason: string }[] };
    expect(data.lines.map((l) => l.entitlementId)).toEqual([readerId]);
    expect(data.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ entitlementId: writerId, reason: "already has it" }), expect.objectContaining({ entitlementId: adminEntId, reason: "not requestable" })]),
    );
    expect((await request.get(`/api/v1/access/requests/model-after?subject=${personX}&model=nobody`)).status()).toBe(400);
  });

  test("a basket makes one request per person and item, each checked on its own; a repeat returns the open ones", async ({ request }) => {
    expect((await request.post("/api/v1/access/requests/basket", { data: { subjectIdentityIds: [], lines: [{ applicationId: appId, entitlementId: readerId }] } })).status()).toBe(400);
    const body = {
      subjectIdentityIds: [personX, personZ],
      lines: [
        { applicationId: appId, entitlementId: readerId },
        { applicationId: appId, entitlementId: adminEntId },
      ],
      justification: "New project team",
    };
    const res = await request.post("/api/v1/access/requests/basket", { data: body });
    expect(res.status(), await res.text()).toBe(200);
    const sent = (await res.json()).data as { basketId: string; results: { subjectIdentityId: string; line: number; ok: boolean; code?: string; status?: string }[]; summary: Record<string, unknown> };
    basketId = sent.basketId;
    expect(sent.summary).toMatchObject({ created: 2, existing: 0, refused: 2, byCode: { NOT_REQUESTABLE: 2 } });
    expect(sent.results.filter((r) => r.ok).map((r) => [r.subjectIdentityId, r.line, r.status])).toEqual([
      [personX, 0, "approved"],
      [personZ, 0, "approved"],
    ]);

    const again = (await (await request.post("/api/v1/access/requests/basket", { data: body })).json()).data;
    expect(again.summary).toMatchObject({ created: 0, existing: 2, refused: 2 });

    const listed = (await (await request.get(`/api/v1/access/requests/basket/${basketId}`)).json()).data as { subjectIdentityId: string; entitlementName: string }[];
    expect(listed.map((r) => r.subjectIdentityId).sort()).toEqual([personX, personZ].sort());
    expect(listed.every((r) => r.entitlementName === `Reader ${stamp}`)).toBe(true);
  });

  test("the basket screen", async ({ page }) => {
    await page.goto("/access/catalog");
    await page.getByRole("link", { name: "Several at once" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Request for several" })).toBeVisible();
    await expect(page.getByText(`E2E Basket App ${stamp} — Reader ${stamp}`)).toBeVisible();
  });

  test("another organization cannot put these people in a basket or see it; read-only cannot send one", async ({ browser }) => {
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const res = await two.request.post("/api/v1/access/requests/basket", { data: { subjectIdentityIds: [personX], lines: [{ applicationId: appId, entitlementId: readerId }] } });
    expect(res.status()).toBe(200);
    const data = (await res.json()).data;
    expect(data.summary).toMatchObject({ created: 0, existing: 0, refused: 1 });
    expect(data.results[0]).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(((await (await two.request.get(`/api/v1/access/requests/basket/${basketId}`)).json()).data as unknown[]).length).toBe(0);
    expect((await two.request.get(`/api/v1/access/requests/model-after?subject=${personX}&model=${personY}`)).status()).toBe(404);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.post("/api/v1/access/requests/basket", { data: { subjectIdentityIds: [personX], lines: [{ applicationId: appId, entitlementId: readerId }] } })).status()).toBe(403);
    expect((await ro.request.get(`/api/v1/access/requests/model-after?subject=${personX}&model=${personY}`)).status()).toBe(403);
    await ro.close();
  });
});
