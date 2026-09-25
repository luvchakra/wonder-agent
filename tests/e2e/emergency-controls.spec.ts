import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * RUNTIME-P0-18 — emergency controls and tool filtering, against the real
 * app and database:
 * - the kill switch and a tool suspension are engaged through the UI (with
 *   confirmation and reason), change the gateway's recorded decision, and
 *   can be lifted
 * - tool filtering in observe-only mode hides nothing but reports what
 *   enforcement would hide
 * - "Revoke all keys" cuts the agent off at once
 * - a read-only user sees the controls but cannot operate them
 *
 * A fresh agent is already denied at the lifecycle step, which comes
 * before the emergency step. So these tests read the emergency step's own
 * code, which also leaves other specs' headline codes unaffected while
 * the kill switch is briefly engaged.
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
let secret = "";
let anon: APIRequestContext;
const tool = `e2e_delete_customer_${Date.now()}`;

type Step = { step: string; code: string };
const emergencyStep = (steps: Step[]) => steps.find((s) => s.step === "emergency")?.code;

async function decide(data: Record<string, unknown>) {
  const res = await anon.post("/api/gateway/v1/authorize", { headers: { authorization: `Bearer ${secret}` }, data });
  expect(res.status()).toBe(200);
  return (await res.json()).data as { steps: Step[]; effectiveDecision: string };
}

/**
 * Confirms a ConfirmActionDialog: fills the reason, confirms, and waits
 * for the real server result ("Done."), never an optimistic close. Then
 * closes it. The page may already have re-rendered it away after the
 * server action's revalidation, which is also fine.
 */
async function confirmWithReason(page: Page, buttonName: string, reason: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(reason);
  await dialog.getByRole("button", { name: buttonName }).click();
  const done = dialog.getByText("Done.");
  await expect(done.or(dialog.getByText(/^Failed/))).toBeVisible().catch(() => {});
  await expect(dialog.getByText(/^Failed/)).toHaveCount(0);
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

test.describe.serial("emergency controls", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async ({ baseURL }) => {
    anon = await playwrightRequest.newContext({ baseURL });
  });
  test.afterAll(async () => {
    await anon?.dispose();
  });

  test("setup", async ({ page }) => {
    agentId = await registerAgent(page, `E2E Emergency Agent ${Date.now()}`);
    const res = await page.request.post(`/api/v1/agents/${agentId}/api-keys`, { data: { name: "emergency e2e" } });
    secret = (await res.json()).data.secret;
  });

  test("the kill switch changes the recorded decision, and releasing it restores it", async ({ page }) => {
    await page.goto("/runtime");
    // A previous aborted run may have left it engaged; start from released.
    const release = page.getByRole("button", { name: "Release kill switch" });
    if (await release.isVisible()) {
      await release.click();
      await confirmWithReason(page, "Release", "E2E cleanup of a previous run");
    }
    await page.getByRole("button", { name: "Engage kill switch" }).click();
    await confirmWithReason(page, "Engage kill switch", "E2E incident drill");
    await expect(page.getByRole("button", { name: "Release kill switch" })).toBeVisible();

    try {
      const d = await decide({ requestId: `ks-${Date.now()}`, action: "READ" });
      expect(emergencyStep(d.steps)).toBe("KILL_SWITCH");
      // Observe-only: recorded, not enforced.
      expect(d.effectiveDecision).toBe("ALLOW");
    } finally {
      await page.getByRole("button", { name: "Release kill switch" }).click();
      await confirmWithReason(page, "Release", "E2E drill over");
    }
    await expect(page.getByRole("button", { name: "Engage kill switch" })).toBeVisible();
    const after = await decide({ requestId: `ks-after-${Date.now()}`, action: "READ" });
    expect(emergencyStep(after.steps)).toBe("NO_EMERGENCY_CONTROL");
  });

  test("a suspended tool is denied and would be filtered; lifting restores it", async ({ page }) => {
    await page.goto("/runtime");
    await page.getByLabel("Control").selectOption("tool_suspension");
    await page.getByLabel("Tool name").fill(tool);
    await page.getByRole("button", { name: "Engage", exact: true }).click();
    await confirmWithReason(page, "Engage", "E2E tool suspension");
    const row = page.getByRole("listitem").filter({ hasText: tool });
    await expect(row).toBeVisible();

    const d = await decide({ requestId: `ts-${Date.now()}`, action: "DELETE", tool });
    expect(emergencyStep(d.steps)).toBe("TOOL_SUSPENDED");

    const filter = await anon.post("/api/gateway/v1/tools/filter", {
      headers: { authorization: `Bearer ${secret}` },
      data: { tools: [tool, "get_customer"] },
    });
    expect(filter.status()).toBe(200);
    const f = (await filter.json()).data;
    expect(f.mode).toBe("OBSERVE_ONLY");
    // Observe-only: nothing is hidden, but enforcement's verdict is reported.
    expect(f.visible).toEqual([tool, "get_customer"]);
    expect(f.wouldHide.map((h: { tool: string }) => h.tool)).toContain(tool);

    await row.getByRole("button", { name: "Lift" }).click();
    await confirmWithReason(page, "Lift control", "E2E done");
    await expect(page.getByRole("listitem").filter({ hasText: tool })).toHaveCount(0);
  });

  test("the tool filter requires an agent key", async () => {
    const res = await anon.post("/api/gateway/v1/tools/filter", { data: { tools: ["x"] } });
    expect(res.status()).toBe(401);
  });

  test("a read-only user sees the controls but has no way to operate them", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("readOnly") });
    const page = await ctx.newPage();
    await page.goto("/runtime");
    await expect(page.getByRole("heading", { name: "Emergency controls" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Engage kill switch" })).toHaveCount(0);
    await ctx.close();
  });

  test("revoke all keys cuts the agent off at once", async ({ page }) => {
    await page.goto(`/agents/${agentId}`);
    await page.getByRole("button", { name: "Revoke all keys" }).click();
    await confirmWithReason(page, "Revoke all keys", "E2E credential compromise drill");
    const res = await anon.post("/api/gateway/v1/authorize", { headers: { authorization: `Bearer ${secret}` }, data: { requestId: "x", action: "READ" } });
    expect(res.status()).toBe(401);
  });
});
