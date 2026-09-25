import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * ACCESS-P0-12 — policy targets and the publish step, against the real app,
 * database and Runtime Gateway:
 * - a draft policy has no effect on runtime decisions
 * - publishing it (policy.publish) makes it take effect as a new version
 * - it applies only to its target (one tool), not to other requests
 * - a read-only user cannot publish
 * The policy targets a tool unique to this run and is disabled in
 * `finally`, so no other spec is affected.
 */

const tool = `e2e_publish_tool_${Date.now()}`;
let anon: APIRequestContext;

async function registerAgent(page: Page): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(`E2E Policy Agent ${Date.now()}`);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

test.describe.serial("policy targets and publishing", () => {
  test.use({ storageState: authFile("adminOne") });
  test.beforeAll(async ({ baseURL }) => {
    anon = await playwrightRequest.newContext({ baseURL });
  });
  test.afterAll(async () => {
    await anon?.dispose();
  });

  test("a draft has no effect; publishing makes it apply to its target only", async ({ page, browser }) => {
    const agentId = await registerAgent(page);
    const secret = (await (await page.request.post(`/api/v1/agents/${agentId}/api-keys`, { data: { name: "policy e2e" } })).json()).data.secret;
    const policyStep = async (requestTool: string) => {
      const res = await anon.post("/api/gateway/v1/authorize", {
        headers: { authorization: `Bearer ${secret}` },
        data: { requestId: `pub-${Date.now()}-${Math.random()}`, action: "READ", tool: requestTool },
      });
      expect(res.status()).toBe(200);
      return ((await res.json()).data.steps as Array<{ step: string; code: string }>).find((s) => s.step === "runtime_policy")?.code;
    };

    await page.goto("/policies");
    await page.getByLabel("Policy name").fill(`E2E publish ${Date.now()}`);
    await page.getByLabel("Category", { exact: true }).selectOption("runtime");
    await page.getByLabel("Action", { exact: true }).selectOption("block");
    await page.getByLabel("Applies to", { exact: true }).selectOption("TOOL");
    await page.getByLabel("Target", { exact: true }).fill(tool);
    await page.getByLabel("Status", { exact: true }).selectOption("draft");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/\/policies\/[0-9a-f-]{36}$/);
    const policyId = page.url().split("/policies/")[1];

    try {
      await expect(page.getByText("draft", { exact: true })).toBeVisible();
      await expect(page.getByText(`tool “${tool}”`)).toBeVisible();
      expect(
        (await page.request.post(`/api/v1/policies/${policyId}/rules`, { data: { ruleType: "abac", condition: { field: "request.action", op: "eq", value: "read" } } })).status(),
      ).toBe(201);

      // Draft: not loaded by the gateway.
      expect(await policyStep(tool)).toBe("NO_POLICY_FIRED");

      // A read-only user cannot publish it.
      const ro = await browser.newContext({ storageState: authFile("readOnly") });
      expect((await ro.request.post(`/api/v1/policies/${policyId}/publish`)).status()).toBe(403);
      await ro.close();

      await page.reload();
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(page.getByText(/Published as version \d+\./)).toBeVisible();
      await expect(page.getByText("In effect")).toBeVisible();

      // Published: it fires for its target, and only for its target.
      expect(await policyStep(tool)).toBe("POLICY_BLOCK");
      expect(await policyStep(`${tool}_other`)).toBe("NO_POLICY_FIRED");

      // Publishing again is refused truthfully.
      expect((await page.request.post(`/api/v1/policies/${policyId}/publish`)).status()).toBe(409);
    } finally {
      await page.request.patch(`/api/v1/policies/${policyId}`, { data: { status: "disabled" } });
    }
  });
});
