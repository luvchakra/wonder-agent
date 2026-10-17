import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { authFile, TEST_USERS } from "./support/testUsers";
import { openConnection, type ReceivingConnection } from "./support/connections";
import { agentIdOnPage } from "./support/objectRefs";
import { getSeededUserId } from "./support/seedTestData";

/**
 * ACCESS-P0-23 part 4 (owner decisions, 17 Oct 2026) — a person lets an AI
 * agent act for them; it takes effect once an owner of the agent approves
 * (never the asker); the Runtime Gateway holds a request on someone's
 * behalf for approval unless an active delegation covers its action.
 */

async function registerAgent(page: Page, name: string): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(name);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/\d+$/);
  return agentIdOnPage(page);
}

const stamp = Date.now();
let agentId = "";
let secret = "";
let requesterId = "";
let delegationId = "";
let anon: APIRequestContext;
let conn: ReceivingConnection;

const stepOf = (d: { steps: { step: string; code: string }[] }) => d.steps.find((s) => s.step === "delegation");

test.describe.serial("delegation to AI agents", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async ({ baseURL }) => {
    anon = await playwrightRequest.newContext({ baseURL });
  });
  test.afterAll(async () => {
    await anon?.dispose();
  });

  test("setup: an agent with a key and its runtime's connection (no owner yet, so an access manager decides)", async ({ page }) => {
    conn = await openConnection(page.request, "runtime-gateway", `E2E delegation runtime ${stamp}`);
    agentId = await registerAgent(page, `E2E Delegate Agent ${stamp}`);
    const key = await page.request.post(`/api/v1/agents/${agentId}/api-keys`, { data: { name: "delegation e2e" } });
    expect(key.status()).toBe(201);
    secret = (await key.json()).data.secret;
    requesterId = await getSeededUserId(TEST_USERS.requester.email);
  });

  test("a request on someone's behalf with no delegation is held for approval", async () => {
    const res = await anon.post(conn.authorize, {
      headers: { authorization: `Bearer ${secret}` },
      data: { requestId: `e2e-dlg-1-${stamp}`, action: "read", onBehalfOf: { kind: "user", id: requesterId } },
    });
    expect(res.status()).toBe(200);
    expect(stepOf((await res.json()).data)).toMatchObject({ code: "DELEGATION_REQUIRED" });
    // Without onBehalfOf, no delegation step at all.
    const own = (await (await anon.post(conn.authorize, { headers: { authorization: `Bearer ${secret}` }, data: { requestId: `e2e-dlg-0-${stamp}`, action: "read" } })).json()).data;
    expect(stepOf(own)).toBeUndefined();
  });

  test("the person asks, and cannot approve it themselves", async ({ browser }) => {
    const asker = await browser.newContext({ storageState: authFile("requester") });
    const made = await asker.request.post("/api/v1/access/agent-delegations", { data: { delegateAgentId: agentId, actions: "read", days: 7, reason: "E2E month-end" } });
    expect(made.status()).toBe(201);
    const d = (await made.json()).data;
    expect(d.status).toBe("pending");
    delegationId = d.id;
    const own = await asker.request.post(`/api/v1/access/agent-delegations/${delegationId}/decision`, { data: { decision: "approve" } });
    expect(own.status()).toBe(403);
    await asker.close();
  });

  test("still held while waiting; once approved on the page, the gateway sees it", async ({ page }) => {
    const waiting = (await (await anon.post(conn.authorize, { headers: { authorization: `Bearer ${secret}` }, data: { requestId: `e2e-dlg-2-${stamp}`, action: "read", onBehalfOf: { kind: "user", id: requesterId } } })).json()).data;
    expect(stepOf(waiting)).toMatchObject({ code: "DELEGATION_REQUIRED" });

    await page.goto("/access/delegations");
    const row = page.getByRole("list", { name: "Agent delegations waiting for you" }).getByRole("listitem").filter({ hasText: `E2E Delegate Agent ${stamp}` });
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("list", { name: "Agent delegations" }).getByRole("listitem").filter({ hasText: `E2E Delegate Agent ${stamp}` })).toContainText("In force");

    const covered = (await (await anon.post(conn.authorize, { headers: { authorization: `Bearer ${secret}` }, data: { requestId: `e2e-dlg-3-${stamp}`, action: "read", onBehalfOf: { kind: "user", id: requesterId } } })).json()).data;
    expect(stepOf(covered)).toMatchObject({ code: "DELEGATION_ACTIVE" });
    const other = (await (await anon.post(conn.authorize, { headers: { authorization: `Bearer ${secret}` }, data: { requestId: `e2e-dlg-4-${stamp}`, action: "write", onBehalfOf: { kind: "user", id: requesterId } } })).json()).data;
    expect(stepOf(other)).toMatchObject({ code: "DELEGATION_REQUIRED" });
  });

  test("ended, the gateway holds it again; another organization sees none of it", async ({ page, browser }) => {
    expect((await page.request.post(`/api/v1/access/agent-delegations/${delegationId}/revoke`)).status()).toBe(200);
    const after = (await (await anon.post(conn.authorize, { headers: { authorization: `Bearer ${secret}` }, data: { requestId: `e2e-dlg-5-${stamp}`, action: "read", onBehalfOf: { kind: "user", id: requesterId } } })).json()).data;
    expect(stepOf(after)).toMatchObject({ code: "DELEGATION_REQUIRED" });

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const listed = (await (await two.request.get("/api/v1/access/agent-delegations")).json()).data as { mine: { id: string }[]; toDecide: { id: string }[] };
    expect([...listed.mine, ...listed.toDecide].some((d) => d.id === delegationId)).toBe(false);
    expect((await two.request.post(`/api/v1/access/agent-delegations/${delegationId}/revoke`)).status()).toBe(404);
    await two.close();
  });
});
