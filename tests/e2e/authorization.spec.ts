import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, TEST_USERS } from "./support/testUsers";
import { getSeededUserId } from "./support/seedTestData";

/**
 * FOUNDATION-P0-19 — scoped role assignments and explicit authorization
 * policies against the real app and database. The requester gets a
 * throwaway custom role holding only agent.update (so nothing another spec
 * checks for the requester changes), and every policy is scoped to this
 * spec's own agent (so other specs acting in the same organization are
 * never refused by it):
 * - a grant scoped to an environment applies to agents there, not
 *   elsewhere, and never to a check that names no agent;
 * - a grant that has not started, or needs MFA the session lacks, does
 *   not apply;
 * - an explicit deny wins over any grant; an exempt role is the
 *   exception; require-approval holds the action; refusals are audited;
 * - a policy can never cover tenant.security.manage; the Tenant
 *   Administrator role cannot be scoped;
 * - the assignment's terms are set and shown through the user screen, and
 *   policies through their screen; another organization sees none of it.
 */

const stamp = Date.now().toString(36);
const roleName = `E2E Agent Editor ${stamp}`;
let roleId = "";
let prodAgent = "";
let devAgent = "";
let requesterId = "";
const policyIds: string[] = [];

async function newAgent(api: APIRequestContext, name: string, environment: string): Promise<string> {
  const res = await api.post("/api/v1/agents", { data: { agentName: name, agentType: "automation", environment, purpose: "Authorization test" } });
  expect([201, 202]).toContain(res.status());
  const body = await res.json();
  return (body.data.id ?? body.data.agent?.id ?? body.data.candidate?.id) as string;
}

test.describe.serial("authorization engine", () => {
  test.describe.configure({ timeout: 90_000 });

  test("setup: two agents in two environments, and an agent-editor role", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const api = admin.request;
    prodAgent = await newAgent(api, `E2E Authz Prod ${stamp}`, "production");
    devAgent = await newAgent(api, `E2E Authz Dev ${stamp}`, "development");
    expect(prodAgent).toMatch(/^[0-9a-f-]{36}$/);
    expect(devAgent).toMatch(/^[0-9a-f-]{36}$/);
    const role = await api.post("/api/v1/roles", { data: { name: roleName, description: "Edits agents", permissions: ["agent.update"] } });
    expect(role.status()).toBe(201);
    roleId = (await role.json()).data.id;
    requesterId = await getSeededUserId(TEST_USERS.requester.email);
    await admin.close();
  });

  test("an environment-scoped grant applies only to agents in that environment", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const requester = await browser.newContext({ storageState: authFile("requester") });
    const edit = (agent: string) => requester.request.post(`/api/v1/agents/${agent}/api-keys`, { data: { name: `e2e ${stamp}` } });

    expect((await edit(prodAgent)).status()).toBe(403);
    const assign = await admin.request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: roleName, scopeType: "environment", scopeValues: ["production"] } });
    expect(assign.status()).toBe(200);
    expect((await edit(prodAgent)).status()).toBe(201);
    expect((await edit(devAgent)).status()).toBe(403);
    // A check that names no agent counts only organization-wide grants.
    const unnamed = await requester.request.delete(`/api/v1/agents/${prodAgent}/relationships?relationshipId=00000000-0000-0000-0000-000000000000`);
    expect(unnamed.status()).toBe(403);

    // Scoped to one agent instead.
    expect((await admin.request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: roleName, scopeType: "agent", scopeValues: [devAgent] } })).status()).toBe(200);
    expect((await edit(devAgent)).status()).toBe(201);
    expect((await edit(prodAgent)).status()).toBe(403);
    await admin.close();
    await requester.close();
  });

  test("a grant that hasn't started, or needs MFA the session lacks, does not apply", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const requester = await browser.newContext({ storageState: authFile("requester") });
    const edit = () => requester.request.post(`/api/v1/agents/${prodAgent}/api-keys`, { data: { name: `e2e ${stamp}` } });
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();

    expect((await admin.request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: roleName, startsAt: later } })).status()).toBe(200);
    expect((await edit()).status()).toBe(403);

    expect((await admin.request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: roleName, requiresMfa: true } })).status()).toBe(200);
    const mfa = await edit();
    expect(mfa.status()).toBe(403);
    expect((await mfa.json()).error.code).toBe("MFA_REQUIRED");

    // An expiry in the past is refused, and the Tenant Administrator role can't be conditioned.
    const past = await admin.request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: roleName, expiresAt: "2020-01-01" } });
    expect(past.status()).toBe(400);
    const admin2 = await admin.request.post(`/api/v1/users/${await getSeededUserId(TEST_USERS.readOnly.email)}/roles`, { data: { role: "TENANT_SUPER_ADMIN", expiresAt: "2099-01-01" } });
    expect(admin2.status()).toBe(400);

    // Back to organization-wide and unconditional.
    expect((await admin.request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: roleName } })).status()).toBe(200);
    expect((await edit()).status()).toBe(201);
    await admin.close();
    await requester.close();
  });

  test("an explicit deny wins, an exempt role is the exception, approval holds the action", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const requester = await browser.newContext({ storageState: authFile("requester") });
    const edit = (agent: string) => requester.request.post(`/api/v1/agents/${agent}/api-keys`, { data: { name: `e2e ${stamp}` } });

    const deny = await admin.request.post("/api/v1/authorization-policies", {
      data: { name: `E2E Freeze ${stamp}`, effect: "DENY", permissions: ["agent.update"], scopeType: "agent", scopeValues: [prodAgent] },
    });
    expect(deny.status()).toBe(201);
    const denyId = (await deny.json()).data.id as string;
    policyIds.push(denyId);
    const refused = await edit(prodAgent);
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error.code).toBe("POLICY_DENIED");
    expect((await edit(devAgent)).status()).toBe(201);
    // The administrator is denied too: the policy overrides every role.
    expect((await admin.request.post(`/api/v1/agents/${prodAgent}/api-keys`, { data: { name: `e2e ${stamp}` } })).status()).toBe(403);

    // The refusal is audited as AUTHORIZATION_DENIED.
    const audit = await admin.request.get(`/api/v1/audit?action=AUTHORIZATION_DENIED&actorId=${requesterId}`);
    expect(audit.status()).toBe(200);
    expect(JSON.stringify((await audit.json()).data)).toContain("POLICY_DENY");

    // Exempting the editor role lets its holders through.
    const exempt = await admin.request.patch(`/api/v1/authorization-policies/${denyId}`, {
      data: { name: `E2E Freeze ${stamp}`, effect: "DENY", permissions: ["agent.update"], scopeType: "agent", scopeValues: [prodAgent], exemptRoleIds: [roleId] },
    });
    expect(exempt.status()).toBe(200);
    expect((await edit(prodAgent)).status()).toBe(201);

    // Require approval instead.
    expect((await admin.request.post(`/api/v1/authorization-policies/${denyId}/status`, { data: { status: "inactive" } })).status()).toBe(200);
    const hold = await admin.request.post("/api/v1/authorization-policies", {
      data: { name: `E2E Four eyes ${stamp}`, effect: "REQUIRE_APPROVAL", permissions: ["agent.*"], scopeType: "agent", scopeValues: [prodAgent] },
    });
    expect(hold.status()).toBe(201);
    policyIds.push((await hold.json()).data.id);
    const held = await edit(prodAgent);
    expect(held.status()).toBe(403);
    expect((await held.json()).error.code).toBe("APPROVAL_REQUIRED");
    await admin.close();
    await requester.close();
  });

  test("no lockout, no foreign reach", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    for (const p of ["tenant.security.manage", "tenant.security.*"]) {
      const res = await admin.request.post("/api/v1/authorization-policies", { data: { name: `E2E Lockout ${stamp}`, effect: "DENY", permissions: [p] } });
      expect(res.status()).toBe(400);
      expect(JSON.stringify((await res.json()).error.fields)).toContain("tenant.security.manage");
    }
    await admin.close();

    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await other.request.get(`/api/v1/authorization-policies/${policyIds[0]}`)).status()).toBe(404);
    expect(JSON.stringify((await (await other.request.get("/api/v1/authorization-policies")).json()).data)).not.toContain(stamp);
    expect((await other.request.delete(`/api/v1/authorization-policies/${policyIds[0]}`)).status()).toBe(404);
    // Tenant Two cannot scope an assignment to Tenant One's agent.
    const t2member = await getSeededUserId(TEST_USERS.multiOrg.email);
    const foreign = await other.request.post(`/api/v1/users/${t2member}/roles`, { data: { role: "AUDITOR", scopeType: "agent", scopeValues: [prodAgent] } });
    expect(foreign.status()).toBe(400);
    await other.close();

    const ro = await browser.newContext({ storageState: authFile("requester") });
    expect((await ro.request.post("/api/v1/authorization-policies", { data: { name: `E2E Nope ${stamp}`, effect: "DENY", permissions: ["agent.update"] } })).status()).toBe(403);
    await ro.close();
  });

  test("the screens: assignment terms on the user page, and the policies screen", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await admin.newPage();
    await page.goto(`/settings/users/${requesterId}`);
    await page.getByLabel("Assign a role").selectOption({ label: `${roleName} (change terms)` });
    await page.getByText("Scope, timing and conditions").click();
    await page.getByLabel("Applies to").first().selectOption("environment");
    await page.getByRole("checkbox", { name: "Production" }).check();
    await page.getByRole("button", { name: "Assign role" }).click();
    await expect(page.getByText(`${roleName} assigned.`)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(roleName) }).getByText("Environment: production")).toBeVisible();

    await page.goto("/settings/authorization-policies");
    await expect(page.getByRole("heading", { name: "Authorization policies", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: `E2E Four eyes ${stamp}` })).toBeVisible();
    await page.getByLabel("Policy name").fill(`E2E Screen policy ${stamp}`);
    await page.getByRole("radio", { name: "Require approval" }).check();
    await page.getByRole("searchbox", { name: "Search permissions" }).fill("agent.delete");
    await page.getByRole("checkbox", { name: /agent\.delete/ }).check();
    await page.locator("#policy-scope").selectOption("agent");
    await page.getByRole("checkbox", { name: `E2E Authz Prod ${stamp}` }).check();
    await page.getByRole("button", { name: "Create policy" }).click();
    await expect(page).toHaveURL(/\/settings\/authorization-policies\/[0-9a-f-]{36}\?created=1/, { timeout: 30_000 });
    policyIds.push(page.url().split("/settings/authorization-policies/")[1]!.split("?")[0]!);
    await expect(page.getByText(`E2E Screen policy ${stamp} was created.`)).toBeVisible();
    await expect(page.getByText(`Agents: E2E Authz Prod ${stamp}`)).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete policy" }).click();
    await expect(page).toHaveURL(/\/settings\/authorization-policies\?deleted=1/);
    policyIds.pop();
    await admin.close();
  });

  test("cleanup: policies deleted, role removed", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    for (const id of policyIds) expect((await admin.request.delete(`/api/v1/authorization-policies/${id}`)).status()).toBe(200);
    expect((await admin.request.delete(`/api/v1/users/${requesterId}/roles?role=${encodeURIComponent(roleName)}`)).status()).toBe(200);
    expect((await admin.request.delete(`/api/v1/roles/${roleId}`)).status()).toBe(200);
    await admin.close();
  });
});
