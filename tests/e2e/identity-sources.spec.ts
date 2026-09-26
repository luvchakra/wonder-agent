import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * INTEGRATION-P0-08/09 — identity sources and reconciliation, against the
 * real app and database: correlation (match, new, ambiguous), attribute
 * precedence between two sources, managers, invalid rows, leavers and the
 * leaver guard, the pending-match decision (once only), the CSV upload UI,
 * and the negative cases (another organization, a role without rights).
 */

const stamp = Date.now();
const mail = (who: string) => `e2e-src-${who}-${stamp}@example.test`;

const MAPPINGS = [
  { source: "employee_id", target: "externalId" },
  { source: "full_name", target: "displayName" },
  { source: "email", target: "email" },
  { source: "department", target: "department" },
  { source: "title", target: "title" },
  { source: "manager_id", target: "managerExternalId" },
  { source: "status", target: "status" },
];

const csv = (rows: string[][]) => ["employee_id,full_name,email,department,title,manager_id,status", ...rows.map((r) => r.join(","))].join("\n");

type Run = { id: string; status: string; dryRun: boolean; createdCount: number; updatedCount: number; unchangedCount: number; pendingCount: number; leaverCount: number; recordsInvalid: number; guardTripped: boolean };

async function runCsv(request: APIRequestContext, sourceId: string, text: string, mode: "full" | "partial" = "full", dryRun = false): Promise<Run> {
  const res = await request.post(`/api/v1/integrations/identity-sources/${sourceId}/runs`, { data: { kind: "upload", mode, dryRun, csvText: text } });
  expect(res.status(), await res.text()).toBe(202);
  const runId = (await res.json()).data.id as string;
  let run: Run | null = null;
  await expect
    .poll(
      async () => {
        run = (await (await request.get(`/api/v1/integrations/identity-sources/runs/${runId}`)).json()).data as Run;
        return run.status;
      },
      { timeout: 30_000, intervals: [500, 1000] },
    )
    .toMatch(/succeeded|partial|failed/);
  return run!;
}

async function createSource(request: APIRequestContext, data: Record<string, unknown>): Promise<string> {
  const res = await request.post("/api/v1/integrations/identity-sources", { data: { template: "csv", attributeMappings: MAPPINGS, ...data } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id as string;
}

async function createPerson(request: APIRequestContext, displayName: string, email: string): Promise<string> {
  const res = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName, email } });
  expect(res.status()).toBe(201);
  return (await res.json()).data.id as string;
}

async function identity(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/v1/identities/${id}`)).json()).data as Record<string, unknown>;
}

let hrId = "";
let existingId = "";
let pendingId = "";
let twinIds: string[] = [];

test.describe.serial("identity sources", () => {
  test.use({ storageState: authFile("adminOne") });

  test("configuration is validated", async ({ request }) => {
    const noId = await request.post("/api/v1/integrations/identity-sources", {
      data: { name: `E2E bad ${stamp}`, template: "csv", attributeMappings: MAPPINGS.filter((m) => m.target !== "externalId") },
    });
    expect(noId.status()).toBe(400);
    const notAuthoritative = await request.post("/api/v1/integrations/identity-sources", {
      data: { name: `E2E bad2 ${stamp}`, template: "csv", attributeMappings: MAPPINGS, authoritativeFields: ["department"] },
    });
    expect(notAuthoritative.status()).toBe(400);
  });

  test("a full import matches, creates, reports invalid rows and holds ambiguous matches", async ({ request }) => {
    existingId = await createPerson(request, `E2E Existing ${stamp}`, mail("existing"));
    twinIds = [await createPerson(request, `E2E Twin ${stamp}`, mail("twin")), await createPerson(request, `E2E Twin ${stamp}`, mail("twin"))];
    hrId = await createSource(request, { name: `E2E HR ${stamp}`, authoritative: true, priority: 10, authoritativeFields: ["department", "title", "managerIdentityId"] });

    const run = await runCsv(
      request,
      hrId,
      csv([
        ["H1", `E2E New ${stamp}`, mail("new"), "Finance", "Analyst", "H2", "active"],
        ["H2", `E2E Existing ${stamp}`, mail("existing"), "Finance", "Controller", "", "active"],
        ["H3", `E2E Twin ${stamp}`, mail("twin"), "Sales", "Rep", "", "active"],
        ["H4", "E2E Bad Email", "not-an-email", "Ops", "", "", "active"],
      ]),
    );
    expect(run).toMatchObject({ status: "partial", createdCount: 1, updatedCount: 1, pendingCount: 1, recordsInvalid: 1, leaverCount: 0 });

    // The matched identity took the authoritative fields; the new one reports to it.
    expect(await identity(request, existingId)).toMatchObject({ department: "Finance", title: "Controller" });
    const created = (await (await request.get(`/api/v1/identities?type=HUMAN&q=${encodeURIComponent(mail("new"))}`)).json()).data as { id: string }[];
    expect(created).toHaveLength(1);
    expect(await identity(request, created[0].id)).toMatchObject({ managerIdentityId: existingId, lifecycleState: "ACTIVE" });

    // The twins were left alone: nothing merged silently.
    for (const id of twinIds) expect(await identity(request, id)).toMatchObject({ department: null });
    const pending = (await (await request.get(`/api/v1/integrations/correlations?sourceId=${hrId}`)).json()).data as { id: string; externalId: string; candidateIdentityIds: string[] }[];
    const twin = pending.find((p) => p.externalId === "H3");
    expect(twin?.candidateIdentityIds.sort()).toEqual([...twinIds].sort());
    pendingId = twin!.id;
  });

  test("a lower-precedence source cannot overwrite what the higher one owns", async ({ request }) => {
    const dirId = await createSource(request, { name: `E2E Directory ${stamp}`, authoritative: true, priority: 50, authoritativeFields: ["department", "title"] });
    const run = await runCsv(request, dirId, csv([["D1", `E2E Existing ${stamp}`, mail("existing"), "Marketing", "Controller", "", "active"]]), "partial");
    expect(run).toMatchObject({ status: "succeeded", createdCount: 0, pendingCount: 0 });
    expect(await identity(request, existingId)).toMatchObject({ department: "Finance" });
  });

  test("a pending match is decided once, by a person", async ({ request }) => {
    const bad = await request.post(`/api/v1/integrations/correlations/${pendingId}`, { data: { action: "link", identityId: existingId } });
    expect(bad.status()).toBe(400);
    const ok = await request.post(`/api/v1/integrations/correlations/${pendingId}`, { data: { action: "link", identityId: twinIds[0] } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).data).toMatchObject({ status: "linked", resolvedIdentityId: twinIds[0] });
    expect(await identity(request, twinIds[0])).toMatchObject({ department: "Sales" });
    const again = await request.post(`/api/v1/integrations/correlations/${pendingId}`, { data: { action: "dismiss" } });
    expect(again.status()).toBe(409);
  });

  test("a preview plans the import, leavers included, and changes nothing", async ({ request }) => {
    const preview = await runCsv(request, hrId, csv([["H1", `E2E New ${stamp}`, mail("new"), "Finance", "Director", "H2", "active"]]), "full", true);
    expect(preview).toMatchObject({ dryRun: true, status: "succeeded", updatedCount: 1, leaverCount: 2, createdCount: 0 });
    expect(await identity(request, existingId)).toMatchObject({ status: "active", lifecycleState: "ACTIVE" });
    const created = (await (await request.get(`/api/v1/identities?type=HUMAN&q=${encodeURIComponent(mail("new"))}`)).json()).data as { id: string }[];
    expect(await identity(request, created[0].id)).toMatchObject({ title: "Analyst" });
  });

  test("records missing from a full import become leavers; a partial import never does that", async ({ request }) => {
    const partial = await runCsv(request, hrId, csv([["H1", `E2E New ${stamp}`, mail("new"), "Finance", "Analyst", "H2", "active"]]), "partial");
    expect(partial.leaverCount).toBe(0);
    expect(await identity(request, existingId)).toMatchObject({ status: "active" });

    const full = await runCsv(request, hrId, csv([["H1", `E2E New ${stamp}`, mail("new"), "Finance", "Analyst", "H2", "active"]]));
    expect(full).toMatchObject({ status: "succeeded", leaverCount: 2, guardTripped: false });
    expect(await identity(request, existingId)).toMatchObject({ status: "inactive", lifecycleState: "LEAVE_PENDING" });
    expect(await identity(request, twinIds[0])).toMatchObject({ status: "inactive", lifecycleState: "LEAVE_PENDING" });
  });

  test("the leaver guard applies nobody when most of the population is missing", async ({ request }) => {
    const guardId = await createSource(request, { name: `E2E Guard ${stamp}`, leaverThresholdPercent: 20 });
    const people = Array.from({ length: 6 }, (_, i) => [`G${i}`, `E2E Guard ${i} ${stamp}`, mail(`guard${i}`), "Ops", "", "", "active"]);
    expect(await runCsv(request, guardId, csv(people))).toMatchObject({ status: "succeeded", createdCount: 6 });
    const truncated = await runCsv(request, guardId, csv(people.slice(0, 1)));
    expect(truncated).toMatchObject({ status: "partial", leaverCount: 0, guardTripped: true });
    const still = (await (await request.get(`/api/v1/identities?type=HUMAN&status=active&q=${encodeURIComponent(`E2E Guard 5 ${stamp}`)}`)).json()).data as unknown[];
    expect(still).toHaveLength(1);
  });

  test("the UI imports a CSV and follows the run", async ({ page }) => {
    await page.goto(`/integrations/sources/${hrId}`);
    await expect(page.getByRole("heading", { level: 1, name: `E2E HR ${stamp}` })).toBeVisible();
    await page.getByLabel("CSV file").setInputFiles({
      name: "hr.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv([["H9", `E2E Via UI ${stamp}`, mail("ui"), "Legal", "Counsel", "", "active"]])),
    });
    await page.getByLabel("Contents").selectOption("partial");
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Reconciliation run" })).toBeVisible();
    await expect(page.getByText("Succeeded")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "H9" })).toBeVisible();

    await page.goto("/integrations/sources");
    await expect(page.getByRole("link", { name: `E2E HR ${stamp}` })).toBeVisible();
    await page.goto("/integrations/correlations");
    await expect(page.getByRole("heading", { level: 1, name: "Pending matches" })).toBeVisible();
  });
});

test.describe("identity sources — other organizations and roles", () => {
  test("another organization can neither see nor run Tenant One's source, nor decide its matches", async ({ browser }) => {
    const one = await browser.newContext({ storageState: authFile("adminOne") });
    const sourceId = await createSource(one.request, { name: `E2E Isolated ${stamp}` });
    await createPerson(one.request, `E2E Iso Twin ${stamp}`, mail("isotwin"));
    await createPerson(one.request, `E2E Iso Twin ${stamp}`, mail("isotwin"));
    await runCsv(one.request, sourceId, csv([["I1", `E2E Iso Twin ${stamp}`, mail("isotwin"), "", "", "", "active"]]), "partial");
    const pending = (await (await one.request.get(`/api/v1/integrations/correlations?sourceId=${sourceId}`)).json()).data as { id: string }[];
    expect(pending).toHaveLength(1);
    await one.close();

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.get(`/api/v1/integrations/identity-sources/${sourceId}`)).status()).toBe(404);
    expect((await two.request.patch(`/api/v1/integrations/identity-sources/${sourceId}`, { data: { priority: 1 } })).status()).toBe(404);
    expect((await two.request.post(`/api/v1/integrations/identity-sources/${sourceId}/runs`, { data: { kind: "upload", csvText: csv([]) } })).status()).toBe(404);
    expect((await two.request.post(`/api/v1/integrations/correlations/${pending[0].id}`, { data: { action: "dismiss" } })).status()).toBe(404);
    const listed = (await (await two.request.get("/api/v1/integrations/identity-sources")).json()).data as { id: string }[];
    expect(listed.some((s) => s.id === sourceId)).toBe(false);
    const theirPending = (await (await two.request.get("/api/v1/integrations/correlations")).json()).data as { id: string }[];
    expect(theirPending.some((p) => p.id === pending[0].id)).toBe(false);
    await two.close();
  });

  test("read-only can look but not configure, run or decide", async ({ browser }) => {
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get("/api/v1/integrations/identity-sources")).status()).toBe(200);
    expect((await ro.request.post("/api/v1/integrations/identity-sources", { data: { name: "forged", template: "csv", attributeMappings: MAPPINGS } })).status()).toBe(403);
    expect((await ro.request.post("/api/v1/integrations/correlations/00000000-0000-4000-8000-000000000000", { data: { action: "dismiss" } })).status()).toBe(403);
    await ro.close();
  });
});
