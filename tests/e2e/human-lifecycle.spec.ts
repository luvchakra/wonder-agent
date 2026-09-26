import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * IDENTITY-P0-18 — the human lifecycle against the real app and database.
 * Joiner, mover and leaver events come from an identity source run and
 * open governed tasks; the ownership transfer actually moves ownership;
 * manual transitions follow the state machine and need reasons; tasks close
 * once; other organizations and read-only roles can change nothing.
 */

const stamp = Date.now();
const mail = (who: string) => `e2e-life-${who}-${stamp}@example.test`;
const MAPPINGS = [
  { source: "id", target: "externalId" },
  { source: "name", target: "displayName" },
  { source: "email", target: "email" },
  { source: "department", target: "department" },
  { source: "manager", target: "managerExternalId" },
];
const csv = (rows: string[][]) => ["id,name,email,department,manager", ...rows.map((r) => r.join(","))].join("\n");

type Lifecycle = {
  events: { eventType: string; fromState: string | null; toState: string | null; origin: string }[];
  tasks: { id: string; taskType: string; status: string; assigneeIdentityId: string | null; eventType: string }[];
};

async function run(request: APIRequestContext, sourceId: string, text: string, mode: "full" | "partial") {
  const res = await request.post(`/api/v1/integrations/identity-sources/${sourceId}/runs`, { data: { kind: "upload", mode, csvText: text } });
  expect(res.status(), await res.text()).toBe(202);
  const runId = (await res.json()).data.id as string;
  await expect
    .poll(async () => ((await (await request.get(`/api/v1/integrations/identity-sources/runs/${runId}`)).json()).data as { status: string }).status, { timeout: 30_000 })
    .toMatch(/succeeded|partial|failed/);
}

async function lifecycle(request: APIRequestContext, id: string): Promise<Lifecycle> {
  return (await (await request.get(`/api/v1/identities/${id}/lifecycle`)).json()).data as Lifecycle;
}

async function personByEmail(request: APIRequestContext, email: string) {
  const rows = (await (await request.get(`/api/v1/identities?type=HUMAN&q=${encodeURIComponent(email)}`)).json()).data as { id: string }[];
  expect(rows).toHaveLength(1);
  return (await (await request.get(`/api/v1/identities/${rows[0].id}`)).json()).data as { id: string; lifecycleState: string; status: string; department: string | null };
}

let sourceId = "";
let managerId = "";
let personId = "";
let serviceAccountId = "";

test.describe.serial("human lifecycle", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a source's new person is a joiner with work for their manager", async ({ request }) => {
    const src = await request.post("/api/v1/integrations/identity-sources", {
      data: { name: `E2E Lifecycle HR ${stamp}`, template: "csv", attributeMappings: MAPPINGS, authoritative: true, priority: 10, authoritativeFields: ["department", "managerIdentityId"] },
    });
    expect(src.status()).toBe(201);
    sourceId = (await src.json()).data.id;
    await run(
      request,
      sourceId,
      csv([
        ["M1", `E2E Life Manager ${stamp}`, mail("manager"), "Finance", ""],
        ["P1", `E2E Life Person ${stamp}`, mail("person"), "Finance", "M1"],
      ]),
      "full",
    );
    managerId = (await personByEmail(request, mail("manager"))).id;
    const person = await personByEmail(request, mail("person"));
    personId = person.id;
    expect(person.lifecycleState).toBe("ACTIVE");
    const life = await lifecycle(request, personId);
    expect(life.events.map((e) => e.eventType)).toEqual(["joiner"]);
    expect(life.tasks).toEqual([expect.objectContaining({ taskType: "request_baseline_access", status: "open", assigneeIdentityId: managerId, eventType: "joiner" })]);
  });

  test("a department change from the source is a mover with an access review", async ({ request }) => {
    const svc = await request.post("/api/v1/identities", { data: { identityType: "SERVICE_ACCOUNT", displayName: `svc-life-${stamp}`, ownerIdentityId: personId } });
    expect(svc.status()).toBe(201);
    serviceAccountId = (await svc.json()).data.id;

    await run(request, sourceId, csv([["P1", `E2E Life Person ${stamp}`, mail("person"), "Sales", "M1"]]), "partial");
    const life = await lifecycle(request, personId);
    expect(life.events[0]).toMatchObject({ eventType: "mover", origin: "source" });
    expect(life.tasks.some((t) => t.taskType === "review_access" && t.eventType === "mover" && t.status === "open")).toBe(true);
  });

  test("leaving the source makes a leaver with ownership, access and no sign-in task for someone who cannot sign in", async ({ request }) => {
    await run(request, sourceId, csv([["M1", `E2E Life Manager ${stamp}`, mail("manager"), "Finance", ""]]), "full");
    const person = await personByEmail(request, mail("person"));
    expect(person).toMatchObject({ lifecycleState: "LEAVE_PENDING", status: "inactive" });
    const life = await lifecycle(request, personId);
    expect(life.events[0]).toMatchObject({ eventType: "leaver", fromState: "ACTIVE", toState: "LEAVE_PENDING" });
    const leaverTasks = life.tasks.filter((t) => t.eventType === "leaver").map((t) => t.taskType).sort();
    expect(leaverTasks).toEqual(["revoke_access", "transfer_ownership"]);
  });

  test("an ownership transfer moves what the leaver owned, and closes once", async ({ request }) => {
    const life = await lifecycle(request, personId);
    const transfer = life.tasks.find((t) => t.taskType === "transfer_ownership")!;
    // Closing it as done while they still own things is refused.
    expect((await request.post(`/api/v1/identities/lifecycle-tasks/${transfer.id}`, { data: { action: "done" } })).status()).toBe(409);
    // The new owner must be an active person, not the leaver.
    expect((await request.post(`/api/v1/identities/lifecycle-tasks/${transfer.id}`, { data: { action: "transfer", toIdentityId: personId } })).status()).toBe(400);
    const ok = await request.post(`/api/v1/identities/lifecycle-tasks/${transfer.id}`, { data: { action: "transfer", toIdentityId: managerId } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).data).toMatchObject({ ownedIdentities: 1 });
    const svc = (await (await request.get(`/api/v1/identities/${serviceAccountId}`)).json()).data;
    expect(svc.ownerIdentityId).toBe(managerId);
    expect((await request.post(`/api/v1/identities/lifecycle-tasks/${transfer.id}`, { data: { action: "transfer", toIdentityId: managerId } })).status()).toBe(409);

    const revoke = life.tasks.find((t) => t.taskType === "revoke_access")!;
    expect((await request.post(`/api/v1/identities/lifecycle-tasks/${revoke.id}`, { data: { action: "skipped" } })).status()).toBe(400);
    expect((await request.post(`/api/v1/identities/lifecycle-tasks/${revoke.id}`, { data: { action: "done", note: "Removed in SAP and Snowflake" } })).status()).toBe(200);
  });

  test("manual transitions follow the lifecycle and need a reason to take someone out", async ({ request }) => {
    expect((await request.post(`/api/v1/identities/${personId}/lifecycle`, { data: { toState: "ARCHIVED" } })).status()).toBe(409);
    expect((await request.post(`/api/v1/identities/${personId}/lifecycle`, { data: { toState: "DISABLED" } })).status()).toBe(400);
    expect((await request.post(`/api/v1/identities/${personId}/lifecycle`, { data: { toState: "DISABLED", note: "Last day passed" } })).status()).toBe(201);
    expect((await personByEmail(request, mail("person"))).status).toBe("disabled");
    const rehire = await request.post(`/api/v1/identities/${personId}/lifecycle`, { data: { toState: "ACTIVE", note: "Returning in March" } });
    expect(rehire.status()).toBe(201);
    const life = await lifecycle(request, personId);
    expect(life.events[0]).toMatchObject({ eventType: "rehire", fromState: "DISABLED", toState: "ACTIVE", origin: "manual" });
    expect(life.tasks.filter((t) => t.eventType === "rehire").map((t) => t.taskType).sort()).toEqual(["request_baseline_access", "review_access"]);
    // Machine identities have no joiner-to-leaver lifecycle.
    expect((await request.post(`/api/v1/identities/${serviceAccountId}/lifecycle`, { data: { toState: "DISABLED", note: "x" } })).status()).toBe(400);
  });

  test("the Lifecycle tab shows the state and history and closes a task", async ({ page }) => {
    await page.goto(`/identities/${personId}?tab=lifecycle`);
    await expect(page.getByRole("tab", { name: /Lifecycle/ })).toHaveAttribute("data-state", "active");
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(page.getByText("Rehire", { exact: true }).first()).toBeVisible();
    const task = page.getByRole("listitem").filter({ hasText: "Review access" }).filter({ hasText: "Rehire" }).first();
    await task.getByRole("radio", { name: "Not needed" }).check();
    await task.getByRole("textbox", { name: "Note" }).fill("Same role as before");
    await task.getByRole("button", { name: "Close task" }).click();
    // Closed work leaves the open list and is counted under History.
    await expect(page.getByRole("listitem").filter({ hasText: "Review access" }).filter({ hasText: "Rehire" })).toHaveCount(0);
    await expect(page.getByText(/closed task\(s\)/)).toBeVisible();

    await page.goto("/identities/lifecycle?status=all");
    await expect(page.getByRole("heading", { level: 1, name: "Lifecycle work" })).toBeVisible();
    await expect(page.getByRole("link", { name: `E2E Life Person ${stamp}` }).first()).toBeVisible();
  });
});

test.describe("human lifecycle — other organizations and roles", () => {
  test("another organization cannot see or change a person's lifecycle; read-only cannot change it", async ({ browser }) => {
    const one = await browser.newContext({ storageState: authFile("adminOne") });
    const p = await one.request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Life Iso ${stamp}` } });
    const id = (await p.json()).data.id as string;
    expect((await one.request.post(`/api/v1/identities/${id}/lifecycle`, { data: { toState: "LEAVE_PENDING", note: "Resigned" } })).status()).toBe(201);
    const task = (await lifecycle(one.request, id)).tasks[0];
    await one.close();

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.post(`/api/v1/identities/${id}/lifecycle`, { data: { toState: "ACTIVE" } })).status()).toBe(404);
    expect((await two.request.post(`/api/v1/identities/lifecycle-tasks/${task.id}`, { data: { action: "done" } })).status()).toBe(404);
    expect(await lifecycle(two.request, id)).toEqual({ events: [], tasks: [] });
    const theirs = (await (await two.request.get("/api/v1/identities/lifecycle-tasks?status=all")).json()).data as { id: string }[];
    expect(theirs.some((t) => t.id === task.id)).toBe(false);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get(`/api/v1/identities/${id}/lifecycle`)).status()).toBe(200);
    expect((await ro.request.post(`/api/v1/identities/${id}/lifecycle`, { data: { toState: "ACTIVE" } })).status()).toBe(403);
    expect((await ro.request.post(`/api/v1/identities/lifecycle-tasks/${task.id}`, { data: { action: "done" } })).status()).toBe(403);
    await ro.close();
  });
});
