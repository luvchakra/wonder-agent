import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * ACCESS-P0-16 — application onboarding against the real app and database
 * (spec §8.6): a missing account identifier stops it; simulation changes
 * nothing; the submitter cannot approve; promotion takes exactly the
 * approved version; a configuration change invalidates validation,
 * simulation and approval; operations the connector does not declare are
 * not automation ready. Other organizations and read-only roles change
 * nothing.
 */

const stamp = Date.now();
let appId = "";

type Onboarding = {
  status: string;
  configVersion: number;
  configHash: string;
  validation: { current: boolean; blockingFailures: string[]; automationReady: boolean; items: { key: string; state: string; blocking: boolean }[] } | null;
  simulation: { current: boolean; passed: boolean; accounts: number } | null;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedHash: string | null;
  promotedHash: string | null;
};

async function step(request: APIRequestContext, id: string, data: Record<string, unknown>) {
  const res = await request.post(`/api/v1/access/applications/${id}/onboarding`, { data });
  const body = await res.json();
  return { status: res.status(), data: body.data as Onboarding, error: body.error as { code: string; message: string } | undefined };
}

async function application(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/v1/access/applications/${id}`)).json()).data as { onboardingStatus: string; sourceIntegrationId: string | null };
}

async function registerApp(request: APIRequestContext, name: string) {
  const owner = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `${name} Owner`, email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.test` } });
  const ownerId = (await owner.json()).data.id as string;
  const res = await request.post("/api/v1/access/applications", {
    data: { name, appType: "saas", businessOwnerIdentityId: ownerId, technicalOwnerIdentityId: ownerId, riskLevel: "high", dataClassification: "confidential" },
  });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).data.id as string;
  const ent = await request.post(`/api/v1/access/applications/${id}/entitlements`, { data: { name: "Reader", dataClassification: "internal", privilegeLevel: "standard" } });
  expect(ent.status(), await ent.text()).toBe(201);
  return id;
}

const COMPLETE = {
  accountIdentifierField: "externalId",
  correlationAccountField: "email",
  correlationIdentityField: "email",
  entitlementSource: "manual",
  requestPolicy: "manager_approval",
  certificationPolicy: "quarterly",
  provenanceEnabled: true,
  disableAccount: true,
  revokeAccess: true,
};

test.describe.serial("application onboarding", () => {
  test.use({ storageState: authFile("adminOne") });

  test("starting onboarding records a first configuration and moves the catalog to Configuring", async ({ request }) => {
    appId = await registerApp(request, `E2E Onb ${stamp}`);
    expect((await step(request, appId, { action: "validate" })).status).toBe(404);
    const started = await step(request, appId, { action: "start", mode: "assisted" });
    expect(started.status).toBe(200);
    expect(started.data).toMatchObject({ status: "CONFIGURING", configVersion: 1, validation: null, simulation: null });
    // Starting again returns the same record.
    expect((await step(request, appId, { action: "start" })).data.configHash).toBe(started.data.configHash);
    expect((await application(request, appId)).onboardingStatus).toBe("CONFIGURING");
  });

  test("a missing account identifier fails validation, and nothing can be simulated or promoted", async ({ request }) => {
    const { accountIdentifierField: _omit, ...partial } = COMPLETE;
    void _omit;
    expect((await step(request, appId, { action: "configure", config: partial })).status).toBe(200);
    const v = await step(request, appId, { action: "validate" });
    expect(v.data.status).toBe("FAILED");
    expect(v.data.validation?.blockingFailures).toContain("account_schema");
    expect((await step(request, appId, { action: "simulate" })).status).toBe(409);
    expect((await step(request, appId, { action: "promote" })).status).toBe(409);
    expect((await application(request, appId)).onboardingStatus).toBe("CONFIGURING");
  });

  test("operations nobody declares are fulfilled by hand: not automation ready, not blocking", async ({ request }) => {
    const c = await step(request, appId, { action: "configure", config: COMPLETE });
    expect(c.data.configVersion).toBe(3);
    const v = await step(request, appId, { action: "validate" });
    expect(v.data.status, JSON.stringify(v.data.validation?.blockingFailures)).toBe("VALIDATING");
    expect(v.data.validation).toMatchObject({ current: true, blockingFailures: [], automationReady: false });
    const deprovision = v.data.validation!.items.find((i) => i.key === "disable_delete_account")!;
    expect(deprovision).toMatchObject({ state: "fail", blocking: false });
    expect(v.data.validation!.items.find((i) => i.key === "create_account")).toMatchObject({ state: "not_applicable" });
  });

  test("simulation reads only and submits for someone else to approve", async ({ request }) => {
    const before = await (await request.get(`/api/v1/access/applications/${appId}/entitlements`)).json();
    const s = await step(request, appId, { action: "simulate" });
    expect(s.status, s.error?.message).toBe(200);
    expect(s.data).toMatchObject({ status: "WAITING_FOR_APPROVAL", simulation: { current: true, passed: true, accounts: 0 } });
    expect(s.data.submittedBy).toBeTruthy();
    const after = await (await request.get(`/api/v1/access/applications/${appId}/entitlements`)).json();
    expect(after.data).toEqual(before.data);
    expect((await application(request, appId)).onboardingStatus).toBe("READY_FOR_APPROVAL");
    // The submitter cannot approve their own submission.
    const own = await step(request, appId, { action: "approve" });
    expect(own.status).toBe(409);
    expect(own.error?.message).toMatch(/other than the submitter/);
    // A rejection needs a reason.
    expect((await step(request, appId, { action: "reject" })).status).toBe(400);
  });

  test("a second person approves; a configuration change after approval cannot be promoted", async ({ browser, request }) => {
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const approved = await step(iam.request, appId, { action: "approve", note: "Checked the simulation" });
    expect(approved.status, approved.error?.message).toBe(200);
    expect(approved.data).toMatchObject({ status: "APPROVED" });
    expect(approved.data.approvedHash).toBe(approved.data.configHash);
    expect(approved.data.approvedBy).not.toBe(approved.data.submittedBy);

    // Changing anything invalidates the approval: promotion is refused.
    const changed = await step(request, appId, { action: "configure", config: { certificationPolicy: "annual" } });
    expect(changed.data).toMatchObject({ status: "CONFIGURING", configVersion: 4, approvedHash: null });
    expect(changed.data.validation?.current).toBe(false);
    expect(changed.data.simulation?.current).toBe(false);
    expect((await step(request, appId, { action: "promote" })).status).toBe(409);
    expect((await application(request, appId)).onboardingStatus).not.toBe("ACTIVE");

    // Round again: validate, simulate (adminOne submits), approve (IAM admin).
    expect((await step(request, appId, { action: "validate" })).data.status).toBe("VALIDATING");
    expect((await step(request, appId, { action: "simulate" })).data.status).toBe("WAITING_FOR_APPROVAL");
    const again = await step(iam.request, appId, { action: "approve" });
    expect(again.status).toBe(200);
    await iam.close();
  });

  test("promotion takes exactly the approved version and makes the application active", async ({ request }) => {
    const current = (await (await request.get(`/api/v1/access/applications/${appId}/onboarding`)).json()).data as Onboarding;
    const promoted = await step(request, appId, { action: "promote" });
    expect(promoted.status, promoted.error?.message).toBe(200);
    expect(promoted.data).toMatchObject({ status: "PROMOTED", promotedHash: current.approvedHash, configVersion: 4 });
    expect((await application(request, appId)).onboardingStatus).toBe("ACTIVE");
    expect((await step(request, appId, { action: "promote" })).status).toBe(409);
  });

  test("a live application is suspended and retired with a reason", async ({ request }) => {
    const lifecycle = (data: Record<string, unknown>) => request.post(`/api/v1/access/applications/${appId}/lifecycle`, { data });
    expect((await lifecycle({ action: "suspend" })).status()).toBe(400);
    expect((await lifecycle({ action: "resume" })).status()).toBe(409);
    expect((await lifecycle({ action: "suspend", note: "Vendor incident" })).status()).toBe(200);
    expect((await application(request, appId)).onboardingStatus).toBe("SUSPENDED");
    expect((await lifecycle({ action: "resume" })).status()).toBe(200);
    expect((await application(request, appId)).onboardingStatus).toBe("ACTIVE");
  });

  test("the onboarding screen shows the steps, the checklist and the live version", async ({ page }) => {
    await page.goto(`/access/applications/${appId}`);
    await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();
    await page.getByRole("link", { name: "Open onboarding" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Onboard E2E Onb ${stamp}` })).toBeVisible();
    await expect(page.getByRole("list", { name: "Onboarding steps" })).toBeVisible();
    await expect(page.getByText("Identity/account schema validated")).toBeVisible();
    await expect(page.getByText(/Not automation ready/)).toBeVisible();
    await expect(page.getByText(/Live since/)).toBeVisible();
  });

  test("the screen walks a new application from start to a failed validation", async ({ page, request }) => {
    const uiAppId = await registerApp(request, `E2E Onb UI ${stamp}`);
    await page.goto(`/access/applications/${uiAppId}/onboarding`);
    await page.getByRole("radio", { name: /Quick start/ }).check();
    await page.getByRole("button", { name: "Start onboarding" }).click();
    await expect(page.getByRole("button", { name: "Save configuration" })).toBeVisible();
    await page.getByRole("button", { name: "Validate", exact: true }).click();
    await expect(page.getByText("Validation found blocking problems.")).toBeVisible();
    await expect(page.getByText("Name the field that uniquely identifies an account")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Simulate/ })).toBeDisabled();

    await page.getByRole("textbox", { name: /Account identifier field/ }).fill("externalId");
    await page.getByRole("button", { name: "Save configuration" }).click();
    await expect(page.getByText("Saved as version 2.")).toBeVisible();
    await expect(page.getByText("The configuration changed since this check; validate again.")).toBeVisible();
  });
});

test.describe("application onboarding — other organizations and roles", () => {
  test("another organization cannot see or drive it; read-only can see but not change it", async ({ browser }) => {
    const one = await browser.newContext({ storageState: authFile("adminOne") });
    const appId = await registerApp(one.request, `E2E Onb Iso ${stamp}`);
    expect((await step(one.request, appId, { action: "start" })).status).toBe(200);
    await one.close();

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const seen = await two.request.get(`/api/v1/access/applications/${appId}/onboarding`);
    expect(seen.status()).toBe(200);
    expect((await seen.json()).data).toBeNull();
    for (const action of ["start", "configure", "validate", "simulate", "approve", "promote"]) {
      expect((await step(two.request, appId, { action, config: COMPLETE, note: "x" })).status, action).toBe(404);
    }
    expect((await two.request.post(`/api/v1/access/applications/${appId}/lifecycle`, { data: { action: "retire", note: "x" } })).status()).toBe(404);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get(`/api/v1/access/applications/${appId}/onboarding`)).status()).toBe(200);
    expect((await step(ro.request, appId, { action: "validate" })).status).toBe(403);
    expect((await ro.request.post(`/api/v1/access/applications/${appId}/lifecycle`, { data: { action: "suspend", note: "x" } })).status()).toBe(403);
    await ro.close();
  });
});
