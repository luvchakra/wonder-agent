import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authFile } from "./support/testUsers";

/**
 * ACCESS-P0-33 part 2 — entitlement classification rules on the shared rule
 * runtime (D12), against the real app and database: validation, simulate
 * before publish, four-eyes publishing, report-only then enforce, an
 * enforced rule applied to the existing entitlements in its scope, a
 * person's value never overridden, the run log, and the negative cases
 * (another organization, a read-only role).
 */

const stamp = Date.now();
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
type Json = { ok: boolean; data?: Record<string, unknown> & { id: string }; error?: { code: string; message: string } };

let appId = "";
let ruleId = "";
let adminEnt = "";
let readerEnt = "";
let personEnt = "";

async function entitlement(request: APIRequestContext, name: string) {
  const res = await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name, dataClassification: "internal", privilegeLevel: "standard" } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as Json).data!.id;
}

const row = async (id: string) => (await db().from("entitlements").select("privilege_level, requestable, sox_relevant, field_provenance").eq("id", id).single()).data!;

test.describe.serial("entitlement classification rules", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: an application with an admin-named, an ordinary and a person-decided entitlement", async ({ request }) => {
    const app = await request.post("/api/v1/access/applications", { data: { name: `E2E Class App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } });
    expect(app.status(), await app.text()).toBe(201);
    appId = ((await app.json()) as Json).data!.id;
    adminEnt = await entitlement(request, `prod-admin-${stamp}`);
    readerEnt = await entitlement(request, `reader-${stamp}`);
    personEnt = await entitlement(request, `kept-admin-${stamp}`);
    // A person decided this one stays requestable.
    expect((await request.patch(`/api/v1/access/entitlements/${personEnt}/governance`, { data: { requestable: true } })).status()).toBe(200);
  });

  test("a rule reads only entitlement and application fields and sets only what a rule may set", async ({ request }) => {
    const base = {
      name: `E2E Class Rule ${stamp}`,
      triggerType: "entitlement.imported",
      applicationIds: [appId],
      condition: 'entitlement.name matches "-admin-"',
      effects: [
        { type: "set_attribute", params: { attribute: "privilegeLevel", value: "admin" } },
        { type: "set_attribute", params: { attribute: "requestable", value: false } },
      ],
    };
    expect((await request.post("/api/v1/access/classification-rules", { data: { ...base, condition: 'identity.department = "x"' } })).status()).toBe(400);
    expect((await request.post("/api/v1/access/classification-rules", { data: { ...base, condition: 'entitlement.colour = "x"' } })).status()).toBe(400);
    expect(
      (await request.post("/api/v1/access/classification-rules", { data: { ...base, effects: [{ type: "set_attribute", params: { attribute: "ownerIdentityId", value: "x" } }] } })).status(),
    ).toBe(400);
    expect(
      (await request.post("/api/v1/access/classification-rules", { data: { ...base, effects: [{ type: "set_attribute", params: { attribute: "privilegeLevel", value: "god" } }] } })).status(),
    ).toBe(400);

    const created = await request.post("/api/v1/access/classification-rules", { data: base });
    expect(created.status(), await created.text()).toBe(201);
    const rule = ((await created.json()) as Json).data!;
    ruleId = rule.id;
    expect(rule).toMatchObject({ mode: "report_only", status: "draft", publishedVersion: 0, applicationIds: [appId] });
  });

  test("publishing needs a simulation first, then someone else's approval; report only changes nothing", async ({ request, browser }) => {
    const early = await request.post(`/api/v1/access/classification-rules/${ruleId}/publish`, { data: { action: "request" } });
    expect(((await early.json()) as Json).error?.code).toBe("NOT_SIMULATED");

    const sim = await request.post(`/api/v1/access/classification-rules/${ruleId}/simulate`);
    expect(sim.status()).toBe(200);
    const result = (
      (await sim.json()) as { data: { evaluated: number; matched: number; changes: { entitlementId: string; field: string; after: unknown }[]; skipped: { entitlementId: string; field: string }[] } }
    ).data;
    expect(result).toMatchObject({ evaluated: 3, matched: 2 });
    expect(
      result.changes
        .filter((c) => c.entitlementId === adminEnt)
        .map((c) => c.field)
        .sort(),
    ).toEqual(["privilegeLevel", "requestable"]);
    expect(result.changes.some((c) => c.entitlementId === readerEnt)).toBe(false);
    // The person's decision is kept: requestable is skipped, the privilege level is not.
    expect(result.skipped).toContainEqual(expect.objectContaining({ entitlementId: personEnt, field: "requestable" }));
    expect(await row(adminEnt)).toMatchObject({ privilege_level: "standard", requestable: true });

    expect((await request.post(`/api/v1/access/classification-rules/${ruleId}/publish`, { data: { action: "request" } })).status()).toBe(200);
    const self = await request.post(`/api/v1/access/classification-rules/${ruleId}/publish`, { data: { action: "approve" } });
    expect(self.status()).toBe(403);
    expect(((await self.json()) as Json).error?.code).toBe("FOUR_EYES");
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const approved = await iam.request.post(`/api/v1/access/classification-rules/${ruleId}/publish`, { data: { action: "approve" } });
    expect(approved.status(), await approved.text()).toBe(200);
    expect(((await approved.json()) as Json).data).toMatchObject({ status: "published", publishedVersion: 1, mode: "report_only", appliedTo: 0 });
    await iam.close();

    const reported = await entitlement(request, `new-admin-${stamp}`);
    expect(await row(reported)).toMatchObject({ privilege_level: "standard", requestable: true });
    const runs = ((await (await request.get(`/api/v1/access/classification-rules/${ruleId}/runs`)).json()) as { data: { subjectId: string; outcome: string; ruleVersion: number }[] }).data;
    expect(runs.find((r) => r.subjectId === reported)).toMatchObject({ outcome: "reported", ruleVersion: 1 });
  });

  test("enforced once republished: existing entitlements are classified with the rule as provenance; a person's value stays", async ({ request, browser }) => {
    const edit = await request.patch(`/api/v1/access/classification-rules/${ruleId}`, { data: { mode: "enforce" } });
    expect(edit.status()).toBe(200);
    expect(((await edit.json()) as Json).data).toMatchObject({ publishedVersion: 1, lastSimulatedAt: null, unpublishedChanges: true });
    expect((await request.post(`/api/v1/access/classification-rules/${ruleId}/simulate`)).status()).toBe(200);
    expect((await request.post(`/api/v1/access/classification-rules/${ruleId}/publish`, { data: { action: "request" } })).status()).toBe(200);
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const approved = await iam.request.post(`/api/v1/access/classification-rules/${ruleId}/publish`, { data: { action: "approve" } });
    expect(approved.status(), await approved.text()).toBe(200);
    // prod-admin, new-admin and kept-admin each change (kept-admin only its privilege level).
    expect(((await approved.json()) as Json).data).toMatchObject({ publishedVersion: 2, mode: "enforce", appliedTo: 3 });
    await iam.close();

    const admin = await row(adminEnt);
    expect(admin).toMatchObject({ privilege_level: "admin", requestable: false });
    expect((admin.field_provenance as Record<string, unknown>).privilege_level).toMatchObject({ by: "rule", ruleId, ruleVersion: 2 });
    expect(await row(readerEnt)).toMatchObject({ privilege_level: "standard", requestable: true });
    const kept = await row(personEnt);
    expect(kept).toMatchObject({ privilege_level: "admin", requestable: true });
    expect((kept.field_provenance as Record<string, unknown>).requestable).toMatchObject({ by: "person" });

    // A new entitlement is classified as it is created.
    const fresh = await entitlement(request, `later-admin-${stamp}`);
    expect(await row(fresh)).toMatchObject({ privilege_level: "admin", requestable: false });
    const runs = ((await (await request.get(`/api/v1/access/classification-rules/${ruleId}/runs`)).json()) as { data: { subjectId: string; outcome: string; ruleVersion: number }[] }).data;
    expect(runs.find((r) => r.subjectId === fresh)).toMatchObject({ outcome: "applied", ruleVersion: 2 });
  });

  test("the pages show the rule and its state", async ({ page }) => {
    await page.goto("/access/classification-rules");
    await expect(page.getByRole("heading", { level: 1, name: "Classification rules" })).toBeVisible();
    await page.getByRole("link", { name: `E2E Class Rule ${stamp}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: `E2E Class Rule ${stamp}` })).toBeVisible();
    await expect(page.getByText("v2 live", { exact: true })).toBeVisible();
  });

  test("another organization sees and changes none of it; read-only cannot write", async ({ browser }) => {
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const listed = ((await (await two.request.get("/api/v1/access/classification-rules")).json()) as { data: { id: string }[] }).data;
    expect(listed.some((r) => r.id === ruleId)).toBe(false);
    expect((await two.request.get(`/api/v1/access/classification-rules/${ruleId}`)).status()).toBe(404);
    expect((await two.request.patch(`/api/v1/access/classification-rules/${ruleId}`, { data: { name: "forged" } })).status()).toBe(404);
    expect((await two.request.post(`/api/v1/access/classification-rules/${ruleId}/publish`, { data: { action: "approve" } })).status()).toBe(404);
    expect((await two.request.post(`/api/v1/access/classification-rules/${ruleId}/retire`)).status()).toBe(404);
    // Naming another organization's application in a rule's scope is refused.
    const scoped = await two.request.post("/api/v1/access/classification-rules", {
      data: { name: `Forged ${stamp}`, triggerType: "entitlement.imported", applicationIds: [appId], effects: [{ type: "set_attribute", params: { attribute: "soxRelevant", value: true } }] },
    });
    expect(scoped.status()).toBe(404);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.patch(`/api/v1/access/classification-rules/${ruleId}`, { data: { name: "forged" } })).status()).toBe(403);
    expect((await ro.request.post(`/api/v1/access/classification-rules/${ruleId}/simulate`)).status()).toBe(403);
    await ro.close();
  });

  test("retired: it stops running", async ({ request }) => {
    expect((await request.post(`/api/v1/access/classification-rules/${ruleId}/retire`)).status()).toBe(200);
    const after = await entitlement(request, `retired-admin-${stamp}`);
    expect(await row(after)).toMatchObject({ privilege_level: "standard", requestable: true });
    expect((await request.patch(`/api/v1/access/classification-rules/${ruleId}`, { data: { name: "again" } })).status()).toBe(409);
  });
});
