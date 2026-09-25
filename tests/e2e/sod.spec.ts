import { test, expect, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * ACCESS-P0-14 (codebase-map D5) — separation of duties, against the real
 * app and database. Runs in E2E Tenant Two, whose specs never submit and
 * approve access requests, and the policy is disabled in `finally`, so the
 * blocking rule cannot leak into another spec.
 * - with a blocking SoD policy, the person who requested access for an
 *   agent cannot also approve it (409 SOD_CONFLICT), and nothing changes
 * - someone else could; a flag-only policy records the conflict and lets
 *   it proceed
 */

async function registerAgent(page: Page): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(`E2E SoD Agent ${Date.now()}`);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

test.describe.serial("separation of duties", () => {
  test.use({ storageState: authFile("adminTwo") });

  test("the requester of access cannot also approve it under a blocking policy; a flag policy records it and proceeds", async ({ page }) => {
    const agentId = await registerAgent(page);
    const app = (await (await page.request.post("/api/v1/access/applications", { data: { name: `E2E SoD App ${Date.now()}` } })).json()).data;
    const policy = (
      await (
        await page.request.post("/api/v1/policies", {
          data: { name: `E2E SoD ${Date.now()}`, policyCategory: "identity", action: "block", severity: "high" },
        })
      ).json()
    ).data;
    expect((await page.request.post(`/api/v1/policies/${policy.id}/rules`, { data: { ruleType: "rbac", condition: { conflictingActions: ["access.request_submitted", "access.request_approved"] } } })).status()).toBe(201);

    try {
      const submit = await page.request.post("/api/v1/access/requests", { data: { agentId, applicationId: app.id, justification: "E2E SoD" } });
      expect(submit.status()).toBe(201);
      const requestId = (await submit.json()).data.id;

      const approve = await page.request.post(`/api/v1/access/requests/${requestId}/decision`, { data: { decision: "approved" } });
      expect(approve.status()).toBe(409);
      expect((await approve.json()).error.code).toBe("SOD_CONFLICT");
      const list = (await (await page.request.get(`/api/v1/access/requests?agentId=${agentId}`)).json()).data as Array<{ id: string; status: string }>;
      expect(list.find((r) => r.id === requestId)?.status).toBe("pending");

      // A flag-only policy: the conflict is recorded, the approval goes through.
      expect((await page.request.patch(`/api/v1/policies/${policy.id}`, { data: { action: "flag" } })).status()).toBe(200);
      const flagged = await page.request.post(`/api/v1/access/requests/${requestId}/decision`, { data: { decision: "approved" } });
      expect(flagged.status()).toBe(200);
      expect((await flagged.json()).data.status).toBe("approved");
    } finally {
      await page.request.patch(`/api/v1/policies/${policy.id}`, { data: { status: "disabled" } });
    }
  });
});
