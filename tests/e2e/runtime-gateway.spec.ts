import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * RUNTIME-P0-15 — the Runtime Gateway, against the real app and database.
 * These are the gateway's own security cases (master stories §24; the
 * wider QA-P0-18 suite builds on them):
 * - authentication: no key, a malformed key, a revoked key, or a signed-in
 *   user's session instead of a key → 401
 * - forged tenant/agent: ids in the body are ignored; the key decides
 * - idempotency: the same request id returns the same stored decision
 * - OBSERVE_ONLY: a request the engine would DENY is recorded as DENY,
 *   and the caller is told ALLOW
 * - isolation: another organization never sees these decisions
 */

async function registerAgent(page: Page, name: string): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(name);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

let agentId = "";
let agentName = "";
let secret = "";
let keyId = "";
let anon: APIRequestContext;

const authorize = (headers: Record<string, string>, data: unknown) =>
  anon.post("/api/gateway/v1/authorize", { headers: { "content-type": "application/json", ...headers }, data });

test.describe.serial("runtime gateway", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async ({ baseURL }) => {
    // A context with no cookies at all: an agent is not a browser user.
    anon = await playwrightRequest.newContext({ baseURL });
  });
  test.afterAll(async () => {
    await anon?.dispose();
  });

  test("setup: an agent with an API key", async ({ page }) => {
    agentName = `E2E Gateway Agent ${Date.now()}`;
    agentId = await registerAgent(page, agentName);
    const res = await page.request.post(`/api/v1/agents/${agentId}/api-keys`, { data: { name: "gateway e2e" } });
    expect(res.status()).toBe(201);
    const body = await res.json();
    secret = body.data.secret;
    keyId = body.data.key.id;
    expect(secret).toMatch(/^wa_ak_/);
  });

  test("rejects a request with no key, a malformed key, or only a user session", async ({ page }) => {
    expect((await authorize({}, { requestId: "x", action: "READ" })).status()).toBe(401);
    expect((await authorize({ authorization: "Bearer not-a-key" }, { requestId: "x", action: "READ" })).status()).toBe(401);
    expect((await authorize({ authorization: `Bearer wa_ak_${"A".repeat(43)}` }, { requestId: "x", action: "READ" })).status()).toBe(401);
    // A signed-in administrator's session is not an agent credential.
    const withSession = await page.request.post("/api/gateway/v1/authorize", { data: { requestId: "x", action: "READ" } });
    expect(withSession.status()).toBe(401);
  });

  test("validates the body", async () => {
    const auth = { authorization: `Bearer ${secret}` };
    expect((await authorize(auth, { action: "READ" })).status()).toBe(400);
    expect((await authorize(auth, { requestId: "r", action: "x".repeat(300) })).status()).toBe(400);
  });

  test("observe-only: the engine's DENY is recorded, the caller is told to proceed", async () => {
    // A freshly registered agent is not in an operating lifecycle state
    // and has no contract, so enforcement would deny it.
    const res = await authorize({ authorization: `Bearer ${secret}` }, { requestId: "e2e-1", action: "READ", application: "Snowflake" });
    expect(res.status()).toBe(200);
    const d = (await res.json()).data;
    expect(d.mode).toBe("OBSERVE_ONLY");
    expect(d.enforced).toBe(false);
    expect(d.decision).toBe("DENY");
    expect(d.effectiveDecision).toBe("ALLOW");
    expect(d.code).toBe("AGENT_NOT_OPERATING");
    expect(d.steps.map((s: { step: string }) => s.step)).toContain("approved_access");
    expect(d.replayed).toBe(false);
  });

  test("the same request id returns the same stored decision", async () => {
    const auth = { authorization: `Bearer ${secret}` };
    const a = (await (await authorize(auth, { requestId: "e2e-2", action: "READ" })).json()).data;
    const b = (await (await authorize(auth, { requestId: "e2e-2", action: "DELETE" })).json()).data;
    expect(b.decisionId).toBe(a.decisionId);
    expect(b.replayed).toBe(true);
  });

  test("a tenant or agent id in the body is ignored: the key decides", async () => {
    const res = await authorize(
      { authorization: `Bearer ${secret}` },
      { requestId: "e2e-3", action: "READ", tenantId: "00000000-0000-0000-0000-000000000000", agentId: "00000000-0000-0000-0000-000000000000" },
    );
    expect(res.status()).toBe(200);
    // Had the forged agent id been used, the decision would be UNKNOWN_AGENT.
    expect((await res.json()).data.code).not.toBe("UNKNOWN_AGENT");
  });

  test("the decision appears on the Runtime page, and not for another organization", async ({ page, browser }) => {
    await page.goto("/runtime");
    const table = page.getByRole("region", { name: "Authorization decisions" });
    await expect(table.getByRole("link", { name: agentName }).first()).toBeVisible();

    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    const otherPage = await other.newPage();
    await otherPage.goto("/runtime");
    await expect(otherPage.getByRole("heading", { name: "Authorization decisions" })).toBeVisible();
    await expect(otherPage.getByText(agentName)).toHaveCount(0);
    await other.close();
  });

  test("RUNTIME-P0-16: a decision is on the timeline as a decision, and never counts as DID", async ({ page }) => {
    await page.goto("/runtime");
    await page.getByLabel("Result").selectOption("decision");
    const stream = page.getByRole("list", { name: "Activity events" });
    await expect(stream.getByText(agentName).first()).toBeVisible();
    await expect(stream.getByText(/Deny \(observed\)/).first()).toBeVisible();

    // The agent has only gateway decisions, no observed actions: DID is empty.
    const did = await page.request.get(`/api/v1/runtime/agents/${agentId}/did`);
    expect(did.status()).toBe(200);
    const body = await did.json();
    expect(body.data.tuples ?? body.data).toEqual([]);
  });

  test("RUNTIME-P0-17: the comparison shows the latest request as NOW", async ({ page }) => {
    await page.goto(`/runtime/agents/${agentId}`);
    await expect(page.getByText("Current Request (NOW)", { exact: true })).toBeVisible();
    await expect(page.getByText("Approved (SHOULD)", { exact: true })).toBeVisible();
    // The newest decision for this agent is a DENY recorded in observe-only mode.
    await expect(page.getByText(/deny \(observed\)/i)).toBeVisible();
  });

  test("a revoked key stops working at once", async ({ page }) => {
    const revoke = await page.request.delete(`/api/v1/agents/${agentId}/api-keys/${keyId}`, { data: { reason: "e2e" } });
    expect(revoke.status()).toBe(200);
    expect((await authorize({ authorization: `Bearer ${secret}` }, { requestId: "e2e-4", action: "READ" })).status()).toBe(401);
  });
});
