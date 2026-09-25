import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { TENANT_TWO, authFile } from "./support/testUsers";

/**
 * PLATFORM-P0-12 + RUNTIME-P0-15: real enforcement, switched per tenant by
 * a platform administrator (user decision, 2026-09-25).
 * - With `runtime_enforce` on for E2E Tenant Two only, that tenant's agent
 *   is told the real decision (DENY) instead of proceeding.
 * - Tenant One stays observe-only throughout.
 * - With `runtime_observe` off, the gateway refuses the tenant outright
 *   (403); it never answers ALLOW.
 * Every flag is restored in `finally`, so a failure cannot leave Tenant
 * Two enforcing.
 */

async function registerAgent(page: Page, name: string): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(name);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

async function agentKey(storage: string, browser: import("@playwright/test").Browser, name: string): Promise<string> {
  const ctx = await browser.newContext({ storageState: storage });
  const page = await ctx.newPage();
  const agentId = await registerAgent(page, name);
  const res = await page.request.post(`/api/v1/agents/${agentId}/api-keys`, { data: { name: "enforcement e2e" } });
  const secret = (await res.json()).data.secret as string;
  await ctx.close();
  return secret;
}

test.describe.serial("gateway enforcement flags", () => {
  let platform: APIRequestContext;
  let anon: APIRequestContext;
  let tenantTwoId = "";
  let keyTwo = "";
  let keyOne = "";

  test.beforeAll(async ({ baseURL, browser }) => {
    platform = await playwrightRequest.newContext({ baseURL, storageState: authFile("platformAdmin") });
    anon = await playwrightRequest.newContext({ baseURL });
    const tenants = (await (await platform.get("/api/platform/v1/tenants")).json()).data as Array<{ tenantId: string; slug?: string }>;
    tenantTwoId = tenants.find((t) => t.slug === TENANT_TWO.slug)!.tenantId;
    expect(tenantTwoId).toMatch(/^[0-9a-f-]{36}$/);
    keyTwo = await agentKey(authFile("adminTwo"), browser, `E2E Enforce Agent ${Date.now()}`);
    keyOne = await agentKey(authFile("adminOne"), browser, `E2E Observe Agent ${Date.now()}`);
  });

  test.afterAll(async () => {
    await platform?.dispose();
    await anon?.dispose();
  });

  const setFlag = async (flagKey: string, enabled: boolean) => {
    const res = await platform.put(`/api/platform/v1/tenants/${tenantTwoId}/features`, { data: { flagKey, enabled } });
    expect(res.status()).toBe(200);
  };
  const authorize = (key: string, requestId: string) =>
    anon.post("/api/gateway/v1/authorize", { headers: { authorization: `Bearer ${key}` }, data: { requestId, action: "READ" } });

  test("runtime_enforce on for one tenant: its agent is told DENY; the other tenant still observes", async () => {
    await setFlag("runtime_enforce", true);
    try {
      const enforced = (await (await authorize(keyTwo, `enf-${Date.now()}`)).json()).data;
      expect(enforced.mode).toBe("ENFORCE");
      expect(enforced.enforced).toBe(true);
      // A fresh agent may not act (not in an operating lifecycle state).
      expect(enforced.decision).toBe("DENY");
      expect(enforced.effectiveDecision).toBe("DENY");

      const observed = (await (await authorize(keyOne, `obs-${Date.now()}`)).json()).data;
      expect(observed.mode).toBe("OBSERVE_ONLY");
      expect(observed.effectiveDecision).toBe("ALLOW");
    } finally {
      await setFlag("runtime_enforce", false);
    }
    const back = (await (await authorize(keyTwo, `enf-after-${Date.now()}`)).json()).data;
    expect(back.mode).toBe("OBSERVE_ONLY");
  });

  test("runtime_observe off: the gateway refuses the tenant, never answering ALLOW", async () => {
    await setFlag("runtime_observe", false);
    try {
      const res = await authorize(keyTwo, `off-${Date.now()}`);
      expect(res.status()).toBe(403);
      expect((await res.json()).error.code).toBe("GATEWAY_DISABLED");
    } finally {
      await setFlag("runtime_observe", true);
    }
    expect((await authorize(keyTwo, `on-${Date.now()}`)).status()).toBe(200);
  });
});
