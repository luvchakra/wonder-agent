import { test, expect, type Page } from "@playwright/test";
import { TENANT_ONE, TENANT_TWO, TEST_USERS, authFile } from "./support/testUsers";

/**
 * QA-P0-17 (codebase-map D10) — a member of two organizations sees and
 * acts in the selected one only, against the real app and database.
 *
 * RLS admits every organization a user belongs to, so for this user a read
 * that relies on RLS alone mixes both. The identity used here is READ_ONLY
 * in Tenant One and TENANT_SUPER_ADMIN in Tenant Two, which also proves
 * the role follows the selected organization: selected into Tenant One,
 * it cannot use its Tenant Two admin rights on a Tenant Two object by id;
 * selected into Tenant Two, it cannot point that organization's rows at
 * Tenant One's objects.
 */

const stamp = Date.now();
const sharedName = `E2E MultiOrg Twin ${stamp}`;
let agentOneId = "";
let agentTwoId = "";
let policyTwoId = "";

/** Selects an organization through the sidebar switcher, then waits for the switch to land. */
async function selectOrganization(page: Page, name: string) {
  await page.goto("/agents");
  const switcher = page.getByRole("button", { name: "Switch organization" }).first();
  await switcher.click();
  await page.getByRole("menuitem", { name }).click();
  await expect(page.getByRole("button", { name: "Switch organization" }).first()).toContainText(name);
}

test.describe.serial("a member of two organizations", () => {
  test.use({ storageState: authFile("multiOrg") });

  test("setup: an agent in each organization, and a Tenant Two policy", async ({ browser }) => {
    const one = await browser.newContext({ storageState: authFile("adminOne") });
    const res = await one.request.post("/api/v1/agents", { data: { agentName: sharedName, agentType: "automation", purpose: "QA-P0-17" } });
    expect(res.status()).toBe(201);
    agentOneId = (await res.json()).data.id;
    await one.close();

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const policy = await two.request.post("/api/v1/policies", {
      data: { name: `E2E MultiOrg Policy ${stamp}`, policyCategory: "identity", action: "flag", status: "draft" },
    });
    expect(policy.status()).toBe(201);
    policyTwoId = (await policy.json()).data.id;
    await two.close();
  });

  test("in Tenant Two, registering an agent with the same name as a Tenant One agent is not a duplicate of it", async ({ page }) => {
    await selectOrganization(page, TENANT_TWO.name);
    // Before QA-P0-17 the duplicate check read agents through RLS alone,
    // saw Tenant One's agent, and diverted this to a review (202).
    const res = await page.request.post("/api/v1/agents", { data: { agentName: sharedName, agentType: "automation", purpose: "QA-P0-17" } });
    expect(res.status()).toBe(201);
    agentTwoId = (await res.json()).data.id;
    expect(agentTwoId).not.toBe(agentOneId);

    const listed = (await (await page.request.get("/api/v1/agents?limit=200")).json()).data as { id: string }[];
    expect(listed.map((a) => a.id)).toContain(agentTwoId);
    expect(listed.map((a) => a.id)).not.toContain(agentOneId);
    expect((await page.request.get(`/api/v1/policies/${policyTwoId}`)).status()).toBe(200);
  });

  test("selected into Tenant One, it sees Tenant One only, by list or by id", async ({ page }) => {
    await selectOrganization(page, TENANT_ONE.name);

    const listed = (await (await page.request.get("/api/v1/agents?limit=200")).json()).data as { id: string }[];
    expect(listed.map((a) => a.id)).toContain(agentOneId);
    expect(listed.map((a) => a.id)).not.toContain(agentTwoId);

    // By id: Tenant Two's agent and policy do not resolve here.
    expect((await page.request.get(`/api/v1/agents/${agentTwoId}`)).status()).toBe(404);
    expect((await page.request.get(`/api/v1/policies/${policyTwoId}`)).status()).toBe(404);
    const rules = await page.request.get(`/api/v1/policies/${policyTwoId}/rules`);
    expect((await rules.json()).data ?? []).toEqual([]);
    const versions = await page.request.get(`/api/v1/policies/${policyTwoId}/versions`);
    expect((await versions.json()).data ?? []).toEqual([]);

    // The page renders not-found (a streamed response, so the status can
    // still be 200) and never the other organization's agent.
    await page.goto(`/agents/${agentTwoId}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByRole("heading", { name: sharedName })).toHaveCount(0);

    // Duplicate review and discovery show nothing from Tenant Two.
    const dupes = JSON.stringify((await (await page.request.get("/api/v1/agents/duplicates")).json()).data ?? []);
    expect(dupes).not.toContain(agentTwoId);
  });

  test("selected into Tenant One, its Tenant Two admin role does not carry over", async ({ page }) => {
    await selectOrganization(page, TENANT_ONE.name);
    // READ_ONLY here: no writes, even on a Tenant Two object by id.
    expect((await page.request.post("/api/v1/agents", { data: { agentName: `E2E MultiOrg nope ${stamp}`, agentType: "automation" } })).status()).toBe(403);
    const rule = await page.request.post(`/api/v1/policies/${policyTwoId}/rules`, {
      data: { ruleType: "rbac", condition: { conflictingActions: ["a", "b"] } },
    });
    expect(rule.ok()).toBe(false);
    expect((await page.request.get("/api/v1/users")).status()).toBe(403);
  });

  test("selected into Tenant Two, where it is an admin, it cannot point Tenant Two rows at Tenant One's objects", async ({ page }) => {
    await selectOrganization(page, TENANT_TWO.name);
    // An exception on this organization's policy for the other
    // organization's agent: refused by 0076's same-tenant keys.
    const reason = "QA-P0-17 cross-organization reference";
    const foreign = await page.request.post(`/api/v1/policies/${policyTwoId}/exceptions`, { data: { reason, agentId: agentOneId } });
    expect(foreign.status()).toBe(404);
    // The same exception for its own agent is fine, so the refusal is about
    // the organization, not the request.
    const own = await page.request.post(`/api/v1/policies/${policyTwoId}/exceptions`, { data: { reason, agentId: agentTwoId } });
    expect(own.status()).toBe(201);

    const app = await page.request.post("/api/v1/access/applications", { data: { name: `E2E MultiOrg App ${stamp}` } });
    expect(app.status()).toBe(201);
    const request = await page.request.post("/api/v1/access/requests", {
      data: { agentId: agentOneId, applicationId: (await app.json()).data.id, justification: "QA-P0-17" },
    });
    expect(request.status()).toBe(404);
  });

  test("back in Tenant Two, its admin role applies there and only there", async ({ page }) => {
    await selectOrganization(page, TENANT_TWO.name);
    const members = JSON.stringify((await (await page.request.get("/api/v1/users")).json()).data);
    expect(members).toContain(TEST_USERS.adminTwo.email);
    // The members list is this organization's, not both.
    expect(members).not.toContain(TEST_USERS.adminOne.email);
    expect((await page.request.get(`/api/v1/agents/${agentOneId}`)).status()).toBe(404);
  });
});
