import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * ACCESS-P0-34 — application onboarding templates and the questionnaire,
 * against the real app and database:
 * - a template's defaults fill the draft, its owners fill the application's
 *   empty owners, and its entitlement types are declared;
 * - a template for a connection type does not fit an application without
 *   that connection;
 * - an unanswered required question stops validation; answering after
 *   approval sends the onboarding back to validate and approve again;
 * - another organization and a read-only role see and change nothing.
 */

const stamp = Date.now();
type Json = { ok: boolean; data?: Record<string, unknown> & { id: string }; error?: { code: string; message: string } };

let templateId = "";
let typedTemplateId = "";
let appId = "";
let ownerId = "";

const onb = (request: APIRequestContext, data: Record<string, unknown>) => request.post(`/api/v1/access/applications/${appId}/onboarding`, { data });

async function registerApp(request: APIRequestContext, name: string) {
  const res = await request.post("/api/v1/access/applications", { data: { name, appType: "saas", riskLevel: "low", dataClassification: "internal" } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as Json).data!.id;
}

test.describe.serial("application onboarding templates", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a template is checked like an onboarding configuration", async ({ request }) => {
    const owner = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Tpl Owner ${stamp}` } });
    ownerId = ((await owner.json()) as Json).data!.id;
    const bad = await request.post("/api/v1/access/onboarding-templates", { data: { name: `Bad ${stamp}`, defaults: { requestPolicy: "anyone" } } });
    expect(bad.status()).toBe(400);
    expect((await request.post("/api/v1/access/onboarding-templates", { data: { name: `Bad ${stamp}`, defaults: { entitlementSource: "connector" } } })).status()).toBe(400);

    const created = await request.post("/api/v1/access/onboarding-templates", {
      data: {
        name: `E2E SaaS template ${stamp}`,
        defaults: {
          accountIdentifierField: "id",
          correlationAccountField: "email",
          correlationIdentityField: "email",
          entitlementSource: "manual",
          requestPolicy: "manager_approval",
          certificationPolicy: "annual",
          businessOwnerIdentityId: ownerId,
          technicalOwnerIdentityId: ownerId,
        },
        entitlementTypes: [{ name: "role", maxDurationDays: 90 }],
        questions: [
          { label: "Holds customer data", type: "yes_no", required: true },
          { label: "Hosting", type: "choice", options: ["SaaS", "On premises"] },
        ],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const t = ((await created.json()) as Json).data!;
    templateId = t.id;
    expect(t.questions).toEqual([
      { key: "holds_customer_data", label: "Holds customer data", type: "yes_no", required: true },
      { key: "hosting", label: "Hosting", type: "choice", options: ["SaaS", "On premises"], required: false },
    ]);
    expect((await request.post("/api/v1/access/onboarding-templates", { data: { name: `E2E SAAS TEMPLATE ${stamp}` } })).status()).toBe(409);

    const typed = await request.post("/api/v1/access/onboarding-templates", { data: { name: `E2E Workday template ${stamp}`, connectionTypeKey: "workday" } });
    expect(typed.status(), await typed.text()).toBe(201);
    typedTemplateId = ((await typed.json()) as Json).data!.id;
  });

  test("starting from a template fills the draft, the owners and the entitlement types", async ({ request }) => {
    appId = await registerApp(request, `E2E Tpl App ${stamp}`);
    // A template for a connection type does not fit an application without that connection.
    const misfit = await onb(request, { action: "start", templateId: typedTemplateId });
    expect(misfit.status()).toBe(409);
    expect(((await misfit.json()) as Json).error?.code).toBe("TEMPLATE_DOES_NOT_FIT");

    const started = await onb(request, { action: "start", templateId });
    expect(started.status(), await started.text()).toBe(200);
    expect(((await started.json()) as Json).data).toMatchObject({
      templateId,
      answers: {},
      config: {
        accountIdentifierField: "id",
        correlation: { accountField: "email", identityField: "email" },
        entitlementSource: "manual",
        requestPolicy: "manager_approval",
        certificationPolicy: "annual",
      },
    });
    const app = ((await (await request.get(`/api/v1/access/applications/${appId}`)).json()) as Json).data!;
    expect(app).toMatchObject({ businessOwnerIdentityId: ownerId, technicalOwnerIdentityId: ownerId });
    const types = ((await (await request.get(`/api/v1/access/applications/${appId}/entitlement-types`)).json()) as { data: { name: string; maxDurationDays: number | null }[] }).data;
    expect(types.find((x) => x.name === "role")).toMatchObject({ maxDurationDays: 90 });
  });

  test("an unanswered required question stops validation; answering after approval means approving again", async ({ request, browser }) => {
    test.setTimeout(120_000);
    expect((await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: "Reader", dataClassification: "internal", privilegeLevel: "standard" } })).status()).toBe(201);
    const v1 = ((await (await onb(request, { action: "validate" })).json()) as Json).data!;
    expect(v1.status).toBe("FAILED");
    expect((v1.validation as { blockingFailures: string[] }).blockingFailures).toEqual(["questionnaire"]);

    expect((await onb(request, { action: "answer", answers: { holds_customer_data: "maybe" } })).status()).toBe(400);
    expect((await onb(request, { action: "answer", answers: { shoe_size: "9" } })).status()).toBe(400);
    const answered = await onb(request, { action: "answer", answers: { holds_customer_data: "no", hosting: "SaaS" } });
    expect(answered.status(), await answered.text()).toBe(200);
    expect(((await answered.json()) as Json).data).toMatchObject({ answers: { holds_customer_data: false, hosting: "SaaS" }, status: "CONFIGURING" });

    expect(((await (await onb(request, { action: "validate" })).json()) as Json).data!.status).toBe("VALIDATING");
    expect(((await (await onb(request, { action: "simulate" })).json()) as Json).data!.status).toBe("WAITING_FOR_APPROVAL");
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await onb(iam.request, { action: "approve" })).status()).toBe(200);

    // A changed answer is a change to what was approved.
    const changed = await onb(request, { action: "answer", answers: { hosting: "On premises" } });
    expect(((await changed.json()) as Json).data).toMatchObject({ status: "CONFIGURING", approvedHash: null });
    expect((await onb(request, { action: "promote" })).status()).toBe(409);
    expect(((await (await onb(request, { action: "validate" })).json()) as Json).data!.status).toBe("VALIDATING");
    expect(((await (await onb(request, { action: "simulate" })).json()) as Json).data!.status).toBe("WAITING_FOR_APPROVAL");
    expect((await onb(iam.request, { action: "approve" })).status()).toBe(200);
    await iam.close();
    expect(((await (await onb(request, { action: "promote" })).json()) as Json).data!.status).toBe("PROMOTED");
  });

  test("the pages show the template and the questionnaire", async ({ page }) => {
    await page.goto("/access/onboarding-templates");
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding templates" })).toBeVisible();
    await expect(page.getByRole("link", { name: `E2E SaaS template ${stamp}` })).toHaveAttribute("href", /^\/access\/onboarding-templates\/\d+$/);
    // FOUNDATION-P0-34: an old UUID link redirects to the template's number.
    await page.goto(`/access/onboarding-templates/${templateId}`);
    await expect(page).toHaveURL(/\/access\/onboarding-templates\/\d+$/);
    await page.goto(`/access/applications/${appId}?tab=onboarding`);
    await expect(page.getByText("Questionnaire", { exact: true })).toBeVisible();
    await expect(page.getByText("Every required question is answered.", { exact: false })).toBeVisible();
  });

  test("another organization sees and uses none of it; read-only cannot write", async ({ browser }) => {
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const listed = ((await (await two.request.get("/api/v1/access/onboarding-templates")).json()) as { data: { id: string }[] }).data;
    expect(listed.some((t) => t.id === templateId)).toBe(false);
    expect((await two.request.get(`/api/v1/access/onboarding-templates/${templateId}`)).status()).toBe(404);
    expect((await two.request.patch(`/api/v1/access/onboarding-templates/${templateId}`, { data: { name: "forged" } })).status()).toBe(404);
    expect((await two.request.post(`/api/v1/access/onboarding-templates/${templateId}/retire`)).status()).toBe(404);
    // Its own application cannot start from this organization's template.
    const own = await registerApp(two.request, `E2E Tpl Other ${stamp}`);
    expect((await two.request.post(`/api/v1/access/applications/${own}/onboarding`, { data: { action: "start", templateId } })).status()).toBe(404);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get(`/api/v1/access/onboarding-templates/${templateId}`)).status()).toBe(200);
    expect((await ro.request.post("/api/v1/access/onboarding-templates", { data: { name: `RO ${stamp}` } })).status()).toBe(403);
    expect((await ro.request.patch(`/api/v1/access/onboarding-templates/${templateId}`, { data: { name: "forged" } })).status()).toBe(403);
    await ro.close();
  });

  test("retired: no longer offered or startable", async ({ request }) => {
    expect((await request.post(`/api/v1/access/onboarding-templates/${templateId}/retire`)).status()).toBe(200);
    const listed = ((await (await request.get("/api/v1/access/onboarding-templates")).json()) as { data: { id: string }[] }).data;
    expect(listed.some((t) => t.id === templateId)).toBe(false);
    const other = await registerApp(request, `E2E Tpl Late ${stamp}`);
    const late = await request.post(`/api/v1/access/applications/${other}/onboarding`, { data: { action: "start", templateId } });
    expect(late.status()).toBe(409);
    expect(((await late.json()) as Json).error?.code).toBe("TEMPLATE_RETIRED");
    expect((await request.patch(`/api/v1/access/onboarding-templates/${templateId}`, { data: { name: "again" } })).status()).toBe(409);
  });
});
