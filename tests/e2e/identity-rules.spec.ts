import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authFile } from "./support/testUsers";

/**
 * IDENTITY-P0-21 — attribute rules on the shared rule runtime (D12), against
 * the real app and database: validation against the organization's
 * attributes, simulate before publish, four-eyes publishing, report-only
 * then enforce, rule provenance and the run log, and the negative cases
 * (another organization, a read-only role).
 */

const stamp = Date.now();
const dept = `Finance ${stamp}`;
const attr = `e2e_rr_${stamp}`;

type Json = { ok: boolean; data?: Record<string, unknown> & { id: string }; error?: { code: string; message: string } };
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let ruleId = "";

async function person(request: APIRequestContext, name: string) {
  const res = await request.post("/api/v1/identities", {
    data: { identityType: "HUMAN", displayName: `${name} ${stamp}`, email: `${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}@example.test`, department: dept, title: "Analyst" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as Json).data!;
}

async function publish(admin: APIRequestContext, approver: APIRequestContext) {
  expect((await admin.post(`/api/v1/identities/rules/${ruleId}/simulate`)).status()).toBe(200);
  const asked = await admin.post(`/api/v1/identities/rules/${ruleId}/publish`, { data: { action: "request" } });
  expect(asked.status(), await asked.text()).toBe(200);
  const approved = await approver.post(`/api/v1/identities/rules/${ruleId}/publish`, { data: { action: "approve" } });
  expect(approved.status(), await approved.text()).toBe(200);
  return ((await approved.json()) as Json).data!;
}

test.describe.serial("identity attribute rules", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: an attribute the rule sets", async ({ request }) => {
    const res = await request.post("/api/v1/identities/attributes", { data: { name: attr, displayName: `E2E Rule Region ${stamp}`, dataType: "string", identityType: "HUMAN" } });
    expect(res.status(), await res.text()).toBe(201);
  });

  test("a rule names only known attributes and sets only what a rule may set", async ({ request }) => {
    const base = {
      name: `E2E Rule ${stamp}`,
      triggerType: "identity.created",
      effects: [{ type: "set_attribute", params: { attribute: attr, value: { template: "{identity.department}/{identity.title}" } } }],
    };
    const unknown = await request.post("/api/v1/identities/rules", { data: { ...base, condition: 'identity.shoeSize = "9"' } });
    expect(unknown.status()).toBe(400);
    expect(((await unknown.json()) as Json).error?.message).toContain("Unknown attribute");
    const status = await request.post("/api/v1/identities/rules", { data: { ...base, effects: [{ type: "set_attribute", params: { attribute: "status", value: "terminated" } }] } });
    expect(status.status()).toBe(400);
    const grant = await request.post("/api/v1/identities/rules", { data: { ...base, effects: [{ type: "assign_package", params: { package: "x" } }] } });
    expect(grant.status()).toBe(400);

    const created = await request.post("/api/v1/identities/rules", { data: { ...base, condition: `identity.department = "${dept}"` } });
    expect(created.status(), await created.text()).toBe(201);
    const rule = ((await created.json()) as Json).data!;
    ruleId = rule.id;
    // A new rule only reports, and is not published.
    expect(rule).toMatchObject({ mode: "report_only", status: "draft", publishedVersion: 0 });
  });

  test("publishing needs a simulation first, then someone else's approval", async ({ request, browser }) => {
    const early = await request.post(`/api/v1/identities/rules/${ruleId}/publish`, { data: { action: "request" } });
    expect(((await early.json()) as Json).error?.code).toBe("NOT_SIMULATED");

    const target = await person(request, "Rule Sim");
    const sim = await request.post(`/api/v1/identities/rules/${ruleId}/simulate`);
    expect(sim.status()).toBe(200);
    const result = ((await sim.json()) as { data: { changes: { identityId: string; after: unknown }[]; wouldChange: number } }).data;
    expect(result.changes.find((c) => c.identityId === target.id)).toMatchObject({ after: `${dept}/Analyst` });
    // A simulation changes nothing.
    const after = ((await (await request.get(`/api/v1/identities/${target.id}`)).json()) as Json).data!;
    expect((after.attributes as Record<string, unknown>)[attr]).toBeUndefined();

    expect((await request.post(`/api/v1/identities/rules/${ruleId}/publish`, { data: { action: "request" } })).status()).toBe(200);
    const self = await request.post(`/api/v1/identities/rules/${ruleId}/publish`, { data: { action: "approve" } });
    expect(self.status()).toBe(403);
    expect(((await self.json()) as Json).error?.code).toBe("FOUR_EYES");

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const approved = await iam.request.post(`/api/v1/identities/rules/${ruleId}/publish`, { data: { action: "approve" } });
    expect(approved.status(), await approved.text()).toBe(200);
    expect(((await approved.json()) as Json).data).toMatchObject({ status: "published", publishedVersion: 1, mode: "report_only", publishRequestedBy: null });
    await iam.close();
  });

  test("report only: the run log says what it would do; nothing changes", async ({ request }) => {
    const p = await person(request, "Rule Report");
    expect((p.attributes as Record<string, unknown>)[attr]).toBeUndefined();
    const runs = ((await (await request.get(`/api/v1/identities/rules/${ruleId}/runs`)).json()) as { data: { subjectId: string; outcome: string; ruleVersion: number }[] }).data;
    expect(runs.find((r) => r.subjectId === p.id)).toMatchObject({ outcome: "reported", ruleVersion: 1 });
  });

  test("enforced once republished: the value is set, with the rule as its provenance", async ({ request, browser }) => {
    const edit = await request.patch(`/api/v1/identities/rules/${ruleId}`, { data: { mode: "enforce" } });
    expect(edit.status()).toBe(200);
    // The edit is not live until published again; it must be simulated again first.
    expect(((await edit.json()) as Json).data).toMatchObject({ status: "published", publishedVersion: 1, lastSimulatedAt: null, unpublishedChanges: true });
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect(await publish(request, iam.request)).toMatchObject({ publishedVersion: 2, mode: "enforce" });
    await iam.close();

    const p = await person(request, "Rule Enforce");
    expect((p.attributes as Record<string, unknown>)[attr]).toBe(`${dept}/Analyst`);
    const { data: row } = await db().from("identities").select("field_provenance").eq("id", p.id).single();
    expect((row!.field_provenance as Record<string, { sourceId: string; ruleVersion: number }>)[`attributes.${attr}`]).toMatchObject({ sourceId: `rule:${ruleId}`, ruleVersion: 2 });
    const runs = ((await (await request.get(`/api/v1/identities/rules/${ruleId}/runs`)).json()) as { data: { subjectId: string; outcome: string; ruleVersion: number }[] }).data;
    expect(runs.find((r) => r.subjectId === p.id)).toMatchObject({ outcome: "applied", ruleVersion: 2 });

    // Someone outside the condition is left alone.
    const other = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `Rule Other ${stamp}`, department: "Sales" } });
    expect((((await other.json()) as Json).data!.attributes as Record<string, unknown>)[attr]).toBeUndefined();
  });

  test("the pages show the rule and its one next step", async ({ page }) => {
    await page.goto("/identities/rules");
    await expect(page.getByRole("heading", { level: 1, name: "Identity rules" })).toBeVisible();
    await page.getByRole("link", { name: `E2E Rule ${stamp}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: `E2E Rule ${stamp}` })).toBeVisible();
    // FOUNDATION-P0-34: the rule's number is its URL; an old link with its id redirects there.
    await expect(page).toHaveURL(/\/identities\/rules\/\d+$/);
    const ruleUrl = page.url();
    await page.goto(`/identities/rules/${ruleId}`);
    await expect(page).toHaveURL(ruleUrl);
    await expect(page.getByText("v2 live", { exact: true })).toBeVisible();
    await expect(page.getByText("Applied", { exact: false }).first()).toBeVisible();
  });

  test("retired: it stops running", async ({ request }) => {
    expect((await request.post(`/api/v1/identities/rules/${ruleId}/retire`)).status()).toBe(200);
    const p = await person(request, "Rule Retired");
    expect((p.attributes as Record<string, unknown>)[attr]).toBeUndefined();
    expect((await request.patch(`/api/v1/identities/rules/${ruleId}`, { data: { name: "again" } })).status()).toBe(409);
  });
});

test.describe("identity rules — other organizations and roles", () => {
  test("another organization cannot see or change the rules; read-only cannot write them", async ({ browser }) => {
    const one = await browser.newContext({ storageState: authFile("adminOne") });
    const listed = ((await (await one.request.get("/api/v1/identities/rules")).json()) as { data: { id: string }[] }).data;
    await one.close();
    const anyRule = listed[0]?.id;
    test.skip(!anyRule, "no rule in Tenant One yet");

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.get(`/api/v1/identities/rules/${anyRule}`)).status()).toBe(404);
    expect((await two.request.patch(`/api/v1/identities/rules/${anyRule}`, { data: { name: "forged" } })).status()).toBe(404);
    expect((await two.request.post(`/api/v1/identities/rules/${anyRule}/publish`, { data: { action: "approve" } })).status()).toBe(404);
    expect(((await (await two.request.get(`/api/v1/identities/rules/${anyRule}/runs`)).json()) as { data: unknown[] }).data).toEqual([]);
    const theirs = ((await (await two.request.get("/api/v1/identities/rules")).json()) as { data: { id: string }[] }).data;
    expect(theirs.some((r) => r.id === anyRule)).toBe(false);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get("/api/v1/identities/rules")).status()).toBe(200);
    expect((await ro.request.post("/api/v1/identities/rules", { data: { name: "forged", triggerType: "identity.created", effects: [] } })).status()).toBe(403);
    expect((await ro.request.post(`/api/v1/identities/rules/${anyRule}/simulate`)).status()).toBe(403);
    await ro.close();
  });
});
