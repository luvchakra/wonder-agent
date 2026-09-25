import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * IDENTITY-P0-15/16/17 — the WonderID identity directory, against the real
 * app and database: the rules each identity type must satisfy, attribute
 * enforcement, relationships, the AI agent mirror, and the negative cases
 * (another organization's ids, a read-only role, a role without access).
 */

const stamp = Date.now();
const inAYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

type Json = { ok: boolean; data?: Record<string, unknown> & { id: string }; error?: { code: string; message: string } };

async function findPerson(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.get(`/api/v1/identities?type=HUMAN&q=${encodeURIComponent(email)}`);
  expect(res.status()).toBe(200);
  const rows = (await res.json()).data as { id: string; email: string | null }[];
  const row = rows.find((r) => r.email === email);
  expect(row, `a HUMAN identity for ${email}`).toBeTruthy();
  return row!.id;
}

let adminPersonId = "";
let serviceAccountId = "";
let attributeId = "";

test.describe.serial("identity directory", () => {
  test.use({ storageState: authFile("adminOne") });

  test("every member already has a person identity", async ({ request }) => {
    adminPersonId = await findPerson(request, "e2e-admin-1@e2e.wonderagent.test");
  });

  test("an external identity needs a sponsor, an organization and a future end date", async ({ request }) => {
    const base = { identityType: "EXTERNAL", displayName: `E2E Contractor ${stamp}`, organization: "Acme Consulting", endDate: inAYear };
    const noSponsor = await request.post("/api/v1/identities", { data: base });
    expect(noSponsor.status()).toBe(400);
    expect(((await noSponsor.json()) as Json).error?.message).toContain("sponsor");

    const past = await request.post("/api/v1/identities", { data: { ...base, sponsorIdentityId: adminPersonId, endDate: "2020-01-01" } });
    expect(past.status()).toBe(400);

    const ok = await request.post("/api/v1/identities", { data: { ...base, sponsorIdentityId: adminPersonId } });
    expect(ok.status()).toBe(201);
    const created = ((await ok.json()) as Json).data!;
    expect(created.identityType).toBe("EXTERNAL");
    expect(created.external).toBe(true);
    expect(created.sponsorIdentityId).toBe(adminPersonId);
  });

  test("a machine identity needs an accountable owner who is a person", async ({ request }) => {
    const base = { identityType: "SERVICE_ACCOUNT", displayName: `svc-e2e-${stamp}`, purpose: "Nightly export" };
    expect((await request.post("/api/v1/identities", { data: base })).status()).toBe(400);

    const ok = await request.post("/api/v1/identities", { data: { ...base, ownerIdentityId: adminPersonId } });
    expect(ok.status()).toBe(201);
    serviceAccountId = ((await ok.json()) as Json).data!.id;

    // A machine identity cannot be another machine identity's owner.
    const machineOwner = await request.post("/api/v1/identities", { data: { ...base, displayName: `svc-e2e-b-${stamp}`, ownerIdentityId: serviceAccountId } });
    expect(machineOwner.status()).toBe(400);
  });

  test("AI agents are not created here; their identity follows the agent", async ({ request }) => {
    const direct = await request.post("/api/v1/identities", { data: { identityType: "AI_AGENT", displayName: "forged agent" } });
    expect(direct.status()).toBe(400);

    const agentName = `E2E Identity Mirror ${stamp}`;
    const agent = await request.post("/api/v1/agents", { data: { agentName, agentType: "automation", purpose: "IDENTITY-P0-15" } });
    expect(agent.status()).toBe(201);
    const agentId = (await agent.json()).data.id as string;

    const list = await request.get(`/api/v1/identities?type=AI_AGENT&q=${encodeURIComponent(agentName)}`);
    const rows = (await list.json()).data as { id: string; agentId: string }[];
    const mirror = rows.find((r) => r.agentId === agentId);
    expect(mirror).toBeTruthy();

    // The agent stays canonical: its name is not edited here...
    const rename = await request.patch(`/api/v1/identities/${mirror!.id}`, { data: { displayName: "renamed here" } });
    expect(rename.status()).toBe(400);
    // ...but an accountable owner can be recorded.
    const owner = await request.patch(`/api/v1/identities/${mirror!.id}`, { data: { ownerIdentityId: adminPersonId } });
    expect(owner.status()).toBe(200);
    expect(((await owner.json()) as Json).data!.ownerIdentityId).toBe(adminPersonId);
  });

  test("tenant-defined attributes are typed and enforced", async ({ request }) => {
    const name = `e2e_region_${stamp}`;
    const def = await request.post("/api/v1/identities/attributes", {
      data: { name, displayName: `E2E Region ${stamp}`, dataType: "enum", allowedValues: ["EMEA", "AMER"], identityType: "SERVICE_ACCOUNT" },
    });
    expect(def.status()).toBe(201);
    attributeId = ((await def.json()) as Json).data!.id;

    const bad = await request.patch(`/api/v1/identities/${serviceAccountId}`, { data: { attributes: { [name]: "MARS" } } });
    expect(bad.status()).toBe(400);
    const unknown = await request.patch(`/api/v1/identities/${serviceAccountId}`, { data: { attributes: { not_defined_here: "x" } } });
    expect(unknown.status()).toBe(400);
    const good = await request.patch(`/api/v1/identities/${serviceAccountId}`, { data: { attributes: { [name]: "EMEA" } } });
    expect(good.status()).toBe(200);
    expect(((await good.json()) as Json).data!.attributes).toEqual({ [name]: "EMEA" });

    // Retired, so it never appears on other tests' forms.
    expect((await request.patch(`/api/v1/identities/attributes/${attributeId}`, { data: { active: false } })).status()).toBe(200);
  });

  test("relationships: add, refuse a duplicate, end", async ({ request }) => {
    const add = await request.post(`/api/v1/identities/${adminPersonId}/relationships`, { data: { targetIdentityId: serviceAccountId, relationshipType: "owns" } });
    expect(add.status()).toBe(201);
    const relId = ((await add.json()) as Json).data!.id;
    const dup = await request.post(`/api/v1/identities/${adminPersonId}/relationships`, { data: { targetIdentityId: serviceAccountId, relationshipType: "owns" } });
    expect(dup.status()).toBe(409);
    const self = await request.post(`/api/v1/identities/${adminPersonId}/relationships`, { data: { targetIdentityId: adminPersonId, relationshipType: "owns" } });
    expect(self.status()).toBe(400);

    const listed = (await (await request.get(`/api/v1/identities/${serviceAccountId}/relationships`)).json()).data as { id: string; direction: string; validTo: string | null }[];
    expect(listed.find((r) => r.id === relId)).toMatchObject({ direction: "incoming", validTo: null });

    expect((await request.delete(`/api/v1/identities/relationships/${relId}`)).status()).toBe(200);
    expect((await request.delete(`/api/v1/identities/relationships/${relId}`)).status()).toBe(404);
  });

  test("the UI creates a person and shows the new identity", async ({ page }) => {
    await page.goto("/identities/new?type=HUMAN");
    await expect(page.getByRole("heading", { level: 1, name: "New identity" })).toBeVisible();
    const name = `E2E Person ${stamp}`;
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Email").fill(`e2e-person-${stamp}@example.test`);
    await page.getByLabel("Department").fill("Finance");
    await page.getByRole("button", { name: "Create identity" }).click();
    await expect(page).toHaveURL(/\/identities\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Finance")).toBeVisible();

    // The external form insists on a sponsor before anything is written.
    await page.goto("/identities/new?type=EXTERNAL");
    await expect(page.getByLabel("Sponsor")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Organization" })).toBeVisible();
  });

  test("the overview counts identities and links to each list", async ({ page }) => {
    await page.goto("/identities");
    await expect(page.getByRole("heading", { level: 1, name: "Identities" })).toBeVisible();
    await page.getByRole("link", { name: /Machine/ }).first().click();
    await expect(page).toHaveURL(/\/identities\/machines/);
    await expect(page.getByRole("link", { name: `svc-e2e-${stamp}` })).toBeVisible();
  });
});

test.describe("identity directory — other organizations and roles", () => {
  test("another organization's admin cannot read or reference Tenant One's identities", async ({ browser }) => {
    const one = await browser.newContext({ storageState: authFile("adminOne") });
    const personOne = await findPerson(one.request, "e2e-admin-1@e2e.wonderagent.test");
    await one.close();

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.get(`/api/v1/identities/${personOne}`)).status()).toBe(404);
    expect((await two.request.patch(`/api/v1/identities/${personOne}`, { data: { title: "forged" } })).status()).toBe(404);
    const forged = await two.request.post("/api/v1/identities", {
      data: { identityType: "SERVICE_ACCOUNT", displayName: `svc-forged-${stamp}`, ownerIdentityId: personOne },
    });
    expect(forged.status()).toBe(404);
    const listed = (await (await two.request.get("/api/v1/identities?pageSize=200")).json()).data as { id: string }[];
    expect(listed.some((r) => r.id === personOne)).toBe(false);
    const page = await two.newPage();
    await page.goto(`/identities/${personOne}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await two.close();
  });

  test("read-only can browse but not change; a role without identity.read cannot browse", async ({ browser }) => {
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get("/api/v1/identities")).status()).toBe(200);
    expect((await ro.request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: "forged" } })).status()).toBe(403);
    const page = await ro.newPage();
    await page.goto("/identities");
    await expect(page.getByRole("heading", { level: 1, name: "Identities" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New identity" })).toHaveCount(0);
    await ro.close();

    const requester = await browser.newContext({ storageState: authFile("requester") });
    expect((await requester.request.get("/api/v1/identities")).status()).toBe(403);
    await requester.close();
  });
});
