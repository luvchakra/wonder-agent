import { test, expect, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";
import { agentIdOnPage } from "./support/objectRefs";

/**
 * ACCESS-P0-14 (codebase-map D5) — separation of duties, against the real
 * app and database. Runs in E2E Tenant Two, whose specs never submit and
 * approve access requests, and the policy is disabled in `finally`, so the
 * blocking rule cannot leak into another spec.
 * - with a blocking SoD policy, the person who requested access for an
 *   agent cannot also approve it (409 SOD_CONFLICT), and nothing changes
 * - with a flag-only policy the conflict is recorded, and the approval is
 *   still refused: nobody approves a request they made (SELF_APPROVAL,
 *   owner decision 2026-10-12, WID-C01)
 */

async function registerAgent(page: Page): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(`E2E SoD Agent ${Date.now()}`);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/\d+$/);
  return agentIdOnPage(page);
}

test.describe.serial("separation of duties", () => {
  test.use({ storageState: authFile("adminTwo") });

  test("the requester of access cannot also approve it under a blocking policy; a flag policy records it and still refuses self-approval", async ({ page }) => {
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

      // A flag-only policy: the conflict is recorded, and self-approval is still refused (WID-C01).
      expect((await page.request.patch(`/api/v1/policies/${policy.id}`, { data: { action: "flag" } })).status()).toBe(200);
      const flagged = await page.request.post(`/api/v1/access/requests/${requestId}/decision`, { data: { decision: "approved" } });
      expect(flagged.status()).toBe(409);
      expect((await flagged.json()).error.code).toBe("SELF_APPROVAL");
      const after = (await (await page.request.get(`/api/v1/access/requests?agentId=${agentId}`)).json()).data as Array<{ id: string; status: string }>;
      expect(after.find((r) => r.id === requestId)?.status).toBe("pending");
    } finally {
      await page.request.patch(`/api/v1/policies/${policy.id}`, { data: { status: "disabled" } });
    }

    // ACCESS-P0-35 (owner decision 2026-10-17): every change, the SoD rule included, is a version with what changed; nothing waits for a second person.
    await page.goto(`/policies/${policy.id}`);
    const history = page.getByTestId("policy-history");
    await history.locator("summary").click();
    await expect(history).toContainText("Rule added: separation of duties: access.request_submitted vs access.request_approved");
    await expect(history).toContainText("Action: block → flag");
    await expect(history).toContainText("Status: active → disabled");
  });
});
