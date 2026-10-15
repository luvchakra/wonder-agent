import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authFile } from "./support/testUsers";

/**
 * IDENTITY-P0-18 (finish), against the real app and database:
 * - the manager's "disable all access": their own manager (a member who can
 *   request access) disables a direct report from My Team, with a reason;
 *   anyone else is refused, including themselves, read-only and another
 *   organization;
 * - expiry: a person whose end date has passed becomes a leaver, with the
 *   leaver work opened, by the sweep (run here by viewing Joiner-Mover-Leaver).
 */

const stamp = Date.now();
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Lifecycle = { events: { eventType: string; fromState: string; toState: string; origin: string; note: string | null }[]; tasks: { eventType: string; taskType: string }[] };

async function getLifecycle(request: APIRequestContext, id: string): Promise<Lifecycle> {
  const res = await request.get(`/api/v1/identities/${id}/lifecycle`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data as Lifecycle;
}

async function personId(request: APIRequestContext, email: string): Promise<string> {
  const rows = (await (await request.get(`/api/v1/identities?type=HUMAN&q=${encodeURIComponent(email)}`)).json()).data as { id: string; email: string | null }[];
  const row = rows.find((r) => r.email === email);
  expect(row, `a person for ${email}`).toBeTruthy();
  return row!.id;
}

async function create(request: APIRequestContext, data: Record<string, unknown>): Promise<string> {
  const res = await request.post("/api/v1/identities", { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id as string;
}

let requesterPerson = "";
let report = "";
let stranger = "";

test.describe.serial("manager's disable all access", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: a direct report of the requester, and someone who is not", async ({ request }) => {
    requesterPerson = await personId(request, "e2e-requester@e2e.wonderagent.test");
    report = await create(request, { identityType: "HUMAN", displayName: `E2E Report ${stamp}`, email: `e2e-report-${stamp}@example.test`, managerIdentityId: requesterPerson });
    stranger = await create(request, { identityType: "HUMAN", displayName: `E2E Stranger ${stamp}`, email: `e2e-stranger-${stamp}@example.test` });
  });

  test("refused: not their manager, themselves, no reason, read-only, another organization", async ({ browser }) => {
    const requester = await browser.newContext({ storageState: authFile("requester") });
    const notMine = await requester.request.post(`/api/v1/identities/${stranger}/disable-access`, { data: { reason: "Left the company" } });
    expect(notMine.status()).toBe(403);
    expect((await requester.request.post(`/api/v1/identities/${requesterPerson}/disable-access`, { data: { reason: "x" } })).status()).toBe(403);
    expect((await requester.request.post(`/api/v1/identities/${report}/disable-access`, { data: { reason: " " } })).status()).toBe(400);
    await requester.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.post(`/api/v1/identities/${report}/disable-access`, { data: { reason: "Left" } })).status()).toBe(403);
    await ro.close();

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.post(`/api/v1/identities/${report}/disable-access`, { data: { reason: "Left" } })).status()).toBe(404);
    await two.close();

    // Nothing changed on the report.
    const { data } = await db().from("identities").select("lifecycle_state").eq("id", report).single();
    expect(data!.lifecycle_state).toBe("ACTIVE");
  });

  test("their manager disables them from My Team; the reason and the actor are recorded", async ({ browser, request }) => {
    const requester = await browser.newContext({ storageState: authFile("requester") });
    const page = await requester.newPage();
    await page.goto("/my-team");
    await expect(page.getByRole("heading", { level: 1, name: "My team" })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: `E2E Report ${stamp}` });
    await expect(row).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: `E2E Stranger ${stamp}` })).toHaveCount(0);
    await row.getByText("Disable all access").click();
    await expect(async () => {
      await row.getByLabel(`Reason to disable E2E Report ${stamp}`).fill("Contract terminated today");
      await expect(row.getByRole("button", { name: `Disable E2E Report ${stamp}` })).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await row.getByRole("button", { name: `Disable E2E Report ${stamp}` }).click();
    await expect(row.getByRole("status")).toContainText("is disabled", { timeout: 30_000 });
    await requester.close();

    const life = await getLifecycle(request, report);
    expect(life.events[0]).toMatchObject({ eventType: "disabled", fromState: "ACTIVE", toState: "DISABLED", origin: "manual", note: "Contract terminated today" });
    const { data: audit } = await db().from("audit_logs").select("metadata").eq("object_id", report).eq("action", "identity.access_disabled");
    expect(audit?.[0]?.metadata).toMatchObject({ fromState: "ACTIVE", as: "manager" });
    // Once disabled there is nothing left to stop.
    const again = await request.post(`/api/v1/identities/${report}/disable-access`, { data: { reason: "again" } });
    expect(again.status()).toBe(409);
  });
});

test.describe.serial("expiry", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a person past their end date becomes a leaver, with the leaver work opened", async ({ request, page }) => {
    const sponsor = await personId(request, "e2e-admin-1@e2e.wonderagent.test");
    const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const contractor = await create(request, { identityType: "EXTERNAL", displayName: `E2E Contractor Ends ${stamp}`, sponsorIdentityId: sponsor, organization: "Acme", endDate: inAMonth });
    // Their engagement ended yesterday (set directly: an end date in the past cannot be entered).
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect((await db().from("identities").update({ end_date: yesterday }).eq("id", contractor)).error).toBeNull();

    await page.goto("/identities/lifecycle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const { data } = await db().from("identities").select("lifecycle_state").eq("id", contractor).single();
    expect(data!.lifecycle_state).toBe("LEAVE_PENDING");
    const life = await getLifecycle(request, contractor);
    expect(life.events[0]).toMatchObject({ eventType: "leaver", fromState: "ACTIVE", toState: "LEAVE_PENDING", origin: "schedule", note: `End date ${yesterday} reached` });
    expect(life.tasks.filter((t) => t.eventType === "leaver").map((t) => t.taskType)).toEqual(expect.arrayContaining(["transfer_ownership", "revoke_access"]));

    // The sweep runs once: viewing again records nothing new.
    await page.goto("/identities/lifecycle");
    // Wait for the render (and its sweep) to finish before reading back.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const after = await getLifecycle(request, contractor);
    expect(after.events.length).toBe(life.events.length);
  });
});
