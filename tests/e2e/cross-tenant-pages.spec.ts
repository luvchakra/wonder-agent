import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * QA E2E run 2026-10-01 — cross-tenant direct navigation and Agent 360 tab
 * health, read-only.
 *
 * Tenant Two's real record ids are discovered from Tenant Two's own session
 * (its API), never hard-coded, then opened by a Tenant One administrator
 * through every detail URL that takes an id. Each must render the not-found
 * state and must not show Tenant Two's agent name. The same pages opened on
 * Tenant One's own agent must render (positive control), with no page error.
 *
 * Writes nothing: only GETs and page loads.
 */

type Ids = { tenantId: string; agentId: string; agentName: string; policyId?: string; identityId?: string; campaignId?: string };

async function firstTenantRecords(request: APIRequestContext): Promise<Ids> {
  const get = async (path: string) => {
    const res = await request.get(path);
    expect(res.status(), `${path} as owner`).toBe(200);
    return (await res.json()).data as Array<Record<string, unknown>>;
  };
  const tenant = (await (await request.get("/api/v1/tenant")).json()).data as { id: string };
  const [agents, policies, identities, campaigns] = await Promise.all([
    get("/api/v1/agents"),
    get("/api/v1/policies"),
    get("/api/v1/identities"),
    get("/api/v1/compliance/campaigns"),
  ]);
  const list = (x: unknown) => (Array.isArray(x) ? x : ((x as { items?: unknown[] })?.items ?? [])) as Array<Record<string, unknown>>;
  const agent = list(agents)[0];
  expect(agent, "fixture: the tenant has at least one agent").toBeTruthy();
  return {
    tenantId: tenant.id,
    agentId: String(agent.id),
    agentName: String(agent.displayName ?? agent.agentName ?? agent.agent_name ?? agent.id),
    policyId: list(policies)[0]?.id as string | undefined,
    identityId: list(identities)[0]?.id as string | undefined,
    campaignId: list(campaigns)[0]?.id as string | undefined,
  };
}

function detailUrls(ids: Ids): string[] {
  return [
    `/agents/${ids.agentId}`,
    `/access/agents/${ids.agentId}`,
    `/runtime/agents/${ids.agentId}`,
    `/risk/agents/${ids.agentId}`,
    `/risk/rogue/${ids.agentId}`,
    ...(ids.policyId ? [`/policies/${ids.policyId}`] : []),
    ...(ids.identityId ? [`/identities/${ids.identityId}`] : []),
    ...(ids.campaignId ? [`/compliance/campaigns/${ids.campaignId}`] : []),
  ];
}

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

let tenantTwo: Ids;
let tenantOne: Ids;

test.beforeAll(async ({ playwright, baseURL }) => {
  const two = await playwright.request.newContext({ baseURL, storageState: authFile("adminTwo") });
  const one = await playwright.request.newContext({ baseURL, storageState: authFile("adminOne") });
  [tenantTwo, tenantOne] = await Promise.all([firstTenantRecords(two), firstTenantRecords(one)]);
  await Promise.all([two.dispose(), one.dispose()]);
  expect(tenantTwo.agentId).not.toBe(tenantOne.agentId);
});

test.describe("Tenant One administrator opening Tenant Two's records by URL", () => {
  test.use({ storageState: authFile("adminOne") });

  // The security boundary: nothing of Tenant Two's is rendered.
  test("no detail page shows the other tenant's data", async ({ page }) => {
    test.slow();
    const errors = await collectErrors(page);
    for (const url of detailUrls(tenantTwo)) {
      await page.goto(url, { waitUntil: "networkidle" });
      const main = page.locator("main");
      await expect(main.getByText(tenantTwo.agentName, { exact: false }), `${url} shows Tenant Two's agent name`).toHaveCount(0);
      if (!url.includes(tenantTwo.agentId)) {
        await expect(main.getByText(tenantTwo.agentId), `${url} shows Tenant Two's agent id`).toHaveCount(0);
      }
    }
    expect(errors).toEqual([]);
  });

  // UX/consistency: a foreign id should read as "not found" (or send the
  // user back to the list), never as an empty record of its own.
  // Known defect E2E-015: /compliance/campaigns/[id] renders an empty
  // campaign shell for a foreign id. Remove test.fail once fixed.
  test("every detail page answers with not-found or a redirect to its list", async ({ page }) => {
    test.fail(true, "E2E-015: foreign campaign id renders an empty campaign");
    test.slow();
    for (const url of detailUrls(tenantTwo)) {
      await page.goto(url, { waitUntil: "networkidle" });
      const redirected = new URL(page.url()).pathname !== url;
      if (!redirected) {
        await expect(page.locator("main").getByText(/could not be found|not found/i), `${url} not-found state`).toBeVisible({ timeout: 3_000 });
      }
    }
  });

  // Known defect E2E-016: notFound() runs after the route's loading.tsx
  // has started streaming, so the not-found page is served with HTTP 200.
  // Remove test.fail once the status is 404.
  test("not-found detail pages carry HTTP 404", async ({ page }) => {
    test.fail(true, "E2E-016: soft 404 (status 200)");
    for (const url of [`/agents/${tenantTwo.agentId}`, ...(tenantTwo.policyId ? [`/policies/${tenantTwo.policyId}`] : [])]) {
      const res = await page.goto(url);
      expect(res?.status(), `${url} status`).toBe(404);
    }
  });

  test("tenant_id in the query string does not change the active tenant", async ({ page }) => {
    const res = await page.context().request.get(`/api/v1/agents?tenant_id=${tenantTwo.tenantId}&tenantId=${tenantTwo.tenantId}`);
    const body = await res.text();
    expect(res.status()).toBe(200);
    expect(body).not.toContain(tenantTwo.agentId);
    expect(body).toContain(tenantOne.agentId);
  });
});

test.describe("Agent 360 tabs on the tenant's own agent", () => {
  test.use({ storageState: authFile("adminOne") });

  test("each tab renders, keeps the tab bar, and raises no page error", async ({ page }) => {
    const errors = await collectErrors(page);
    for (const url of detailUrls(tenantOne).slice(0, 4)) {
      const res = await page.goto(url);
      expect(res?.status(), `${url} status`).toBe(200);
      const tabs = page.getByRole("navigation", { name: "Agent sections" });
      await expect(tabs).toBeVisible();
      await expect(tabs.getByRole("link")).toHaveCount(4);
      await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  });
});
