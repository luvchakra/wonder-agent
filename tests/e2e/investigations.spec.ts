import { test, expect, type Page } from "@playwright/test";
import { authFile, TENANT_ONE, TEST_USERS } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";
import { markFindingsResolved, seedFindings } from "./support/seedFindings";

/**
 * RISK-P0-11 — investigations, against the real app and database:
 * - findings are grouped into an investigation with an INV-<year>-<n>
 *   reference, priority from the worst finding, and a timeline
 * - it cannot be marked resolved while a finding is still open, and says so
 * - assigning and notes are recorded on the timeline
 * - once the findings are resolved, the investigation can be resolved
 * - a read-only user can read it but not change it; another organization
 *   cannot see it at all
 */

const stamp = Date.now();
const titles = [`E2E critical finding ${stamp}`, `E2E medium finding ${stamp}`];
let findingIds: string[] = [];
let tenantId = "";
let investigationUrl = "";
let reference = "";

async function registerAgent(page: Page): Promise<string> {
  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(`E2E Investigated Agent ${stamp}`);
  await page.getByLabel("Agent type").fill("automation");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
  return page.url().split("/agents/")[1];
}

test.describe.serial("investigations", () => {
  test.use({ storageState: authFile("adminOne") });

  test("group findings into an investigation", async ({ page }) => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const agentId = await registerAgent(page);
    findingIds = await seedFindings(tenantId, agentId, [
      { title: titles[0], severity: "critical" },
      { title: titles[1], severity: "medium" },
    ]);

    await page.goto("/risk/investigations");
    await page.getByLabel("Title").fill(`E2E investigation ${stamp}`);
    for (const t of titles) await page.getByRole("checkbox", { name: new RegExp(t) }).check();
    await page.getByRole("button", { name: "Open investigation" }).click();
    await expect(page).toHaveURL(/\/risk\/investigations\/[0-9a-f-]{36}$/);
    investigationUrl = new URL(page.url()).pathname;

    await expect(page.getByRole("heading", { name: `E2E investigation ${stamp}` })).toBeVisible();
    await expect(page.getByText(/^INV-\d{4}-\d{3,}$/).first()).toBeVisible();
    reference = ((await page.getByText(/^INV-\d{4}-\d{3,}$/).first().textContent()) ?? "").trim();

    // OPERATIONS-P0-08: search finds it by reference.
    const found = (await (await page.request.get(`/api/v1/search?q=${reference}`)).json()).data as Array<{ objectType: string; href: string }>;
    expect(found.filter((r) => r.objectType === "investigation").map((r) => r.href)).toContain(investigationUrl);
    // Priority defaults to the worst grouped severity.
    await expect(page.getByText("critical", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Opened INV-\d{4}-\d{3,} with 2 finding\(s\), priority critical/)).toBeVisible();
  });

  test("it cannot be resolved while a finding is open, and says why", async ({ page }) => {
    await page.goto(investigationUrl);
    await page.getByLabel("Move to").selectOption("resolved");
    await page.getByLabel("Reason or resolution").fill("Looks fine");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("2 findings are still open; resolve or remediate them first")).toBeVisible();
    await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();
  });

  test("assign it and add a note; both go on the timeline", async ({ page }) => {
    await page.goto(investigationUrl);
    await page.getByLabel("Assignee").selectOption({ label: TEST_USERS.adminOne.email });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Assigned.")).toBeVisible();
    await page.getByLabel("Add a note").fill("Checked the Snowflake entitlement owner");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Note added.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Assigned to ${TEST_USERS.adminOne.email}`)).toBeVisible();
    await expect(page.getByText("Checked the Snowflake entitlement owner")).toBeVisible();
  });

  test("once its findings are resolved, it can be resolved", async ({ page }) => {
    await markFindingsResolved(tenantId, findingIds);
    await page.goto(investigationUrl);
    await page.getByLabel("Move to").selectOption("resolved");
    await page.getByLabel("Reason or resolution").fill("Entitlements removed and re-evaluated clean");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("Status is now resolved.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Resolution: Entitlements removed and re-evaluated clean")).toBeVisible();
  });

  test("a read-only user can read it but not change it", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("readOnly") });
    const page = await ctx.newPage();
    await page.goto(investigationUrl);
    await expect(page.getByRole("heading", { name: `E2E investigation ${stamp}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update status" })).toHaveCount(0);
    const id = investigationUrl.split("/").pop();
    expect((await page.request.post(`/api/v1/risk/investigations/${id}/status`, { data: { status: "in_progress" } })).status()).toBe(403);
    await ctx.close();
  });

  test("another organization cannot see it", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminTwo") });
    const page = await ctx.newPage();
    const id = investigationUrl.split("/").pop();
    expect((await page.request.get(`/api/v1/risk/investigations/${id}`)).status()).toBe(404);
    expect((await page.request.post(`/api/v1/risk/investigations/${id}/status`, { data: { status: "in_progress" } })).status()).toBe(404);
    const list = (await (await page.request.get("/api/v1/risk/investigations")).json()).data as Array<{ id: string }>;
    expect(list.some((i) => i.id === id)).toBe(false);
    const searched = (await (await page.request.get(`/api/v1/search?q=${encodeURIComponent(`${stamp}`)}`)).json()).data as Array<{ objectType: string }>;
    expect(searched.filter((r) => r.objectType === "investigation")).toEqual([]);
    // Nor can it group Tenant One's findings into one of its own.
    const res = await page.request.post("/api/v1/risk/investigations", { data: { title: "cross-tenant", findingIds } });
    expect(res.status()).toBe(404);
    await ctx.close();
  });
});
