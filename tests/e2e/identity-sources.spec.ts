import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";
import { fieldProvenanceOf } from "./support/readAccessGovernance";
import { createClient } from "@supabase/supabase-js";

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

    // WID-H01 (owner decision): the disagreement is on the review list, with both values and sources.
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const open = async () => {
      const { data, error } = await db
        .from("identity_source_conflicts")
        .select("field, kept_value, kept_source_id, other_value, other_source_id")
        .eq("identity_id", existingId)
        .is("resolved_at", null);
      expect(error).toBeNull();
      return data ?? [];
    };
    expect(await open()).toEqual([{ field: "department", kept_value: "Finance", kept_source_id: hrId, other_value: "Marketing", other_source_id: dirId }]);
    const page = await (await request.get("/integrations/correlations")).text();
    expect(page).toContain("Disagreements between sources");
    expect(page).toContain(`E2E Directory ${stamp}`);

    // Once the directory agrees, it resolves by itself.
    await runCsv(request, dirId, csv([["D1", `E2E Existing ${stamp}`, mail("existing"), "Finance", "Controller", "", "active"]]), "partial");
    expect(await open()).toEqual([]);
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
    // FOUNDATION-P0-34: an old link with the source's id redirects to its number.
    await page.goto(`/integrations/sources/${hrId}`);
    await expect(page).toHaveURL(/\/integrations\/sources\/\d+$/);
    await expect(page.getByRole("heading", { level: 1, name: `E2E HR ${stamp}` })).toBeVisible();
    await page.getByLabel("CSV file").setInputFiles({
      name: "hr.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv([["H9", `E2E Via UI ${stamp}`, mail("ui"), "Legal", "Counsel", "", "active"]])),
    });
    await page.getByLabel("Contents").selectOption("partial");
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page).toHaveURL(/\/integrations\/sources\/\d+\/runs\/\d+$/);
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

test.describe.serial("identity sources — custom attributes (INTEGRATION-P0-20)", () => {
  test.use({ storageState: authFile("adminOne") });
  const cc = `e2e_cc_${stamp}`;
  const grade = `e2e_grade_${stamp}`;
  const svcOnly = `e2e_svc_${stamp}`;
  const defIds: string[] = [];
  const header = "employee_id,full_name,email,cost_center,grade";
  const attrMappings = [
    { source: "employee_id", target: "externalId" },
    { source: "full_name", target: "displayName" },
    { source: "email", target: "email" },
    { source: "cost_center", target: `attribute:${cc}` },
    { source: "grade", target: `attribute:${grade}` },
  ];

  test("a mapping must name an existing attribute of the source's identity type; values are typed, unique and carry provenance", async ({ request }) => {
    // Four imports and their reads: about 30 s locally and up to a minute on the Vercel builder.
    test.setTimeout(150_000);
    for (const data of [
      { name: cc, displayName: `E2E Cost centre ${stamp}`, dataType: "string", identityType: "HUMAN", uniqueValue: true },
      { name: grade, displayName: `E2E Grade ${stamp}`, dataType: "number", identityType: "HUMAN" },
      { name: svcOnly, displayName: `E2E Service tier ${stamp}`, dataType: "string", identityType: "SERVICE_ACCOUNT" },
    ]) {
      const res = await request.post("/api/v1/identities/attributes", { data });
      expect(res.status(), await res.text()).toBe(201);
      defIds.push((await res.json()).data.id as string);
    }

    const unknown = await request.post("/api/v1/integrations/identity-sources", {
      data: { name: `E2E attr bad ${stamp}`, template: "csv", attributeMappings: [...attrMappings, { source: "x", target: "attribute:not_defined_here" }] },
    });
    expect(unknown.status()).toBe(400);
    expect(await unknown.text()).toMatch(/does not exist/);
    const wrongType = await request.post("/api/v1/integrations/identity-sources", {
      data: { name: `E2E attr bad2 ${stamp}`, template: "csv", attributeMappings: [...attrMappings, { source: "tier", target: `attribute:${svcOnly}` }] },
    });
    expect(wrongType.status()).toBe(400);
    expect(await wrongType.text()).toMatch(/for SERVICE_ACCOUNT identities/);

    const created = await request.post("/api/v1/integrations/identity-sources", {
      data: { name: `E2E attr HR ${stamp}`, template: "csv", authoritative: true, priority: 10, attributeMappings: attrMappings },
    });
    expect(created.status(), await created.text()).toBe(201);
    const sourceId = (await created.json()).data.id as string;

    const run = await runCsv(
      request,
      sourceId,
      [
        header,
        `A1,E2E Attr One ${stamp},${mail("attr1")},CC-100,3`,
        `A2,E2E Attr Two ${stamp},${mail("attr2")},CC-200,not-a-number`,
        `A3,E2E Attr Three ${stamp},${mail("attr3")},CC-100,4`,
      ].join("\n"),
    );
    // A2's grade is not a number and A3 repeats A1's unique cost centre: neither is applied.
    expect(run).toMatchObject({ createdCount: 1 });
    const find = async (who: string) => ((await (await request.get(`/api/v1/identities?type=HUMAN&q=${encodeURIComponent(mail(who))}`)).json()).data as { id: string }[]);
    const [one] = await find("attr1");
    expect(await identity(request, one.id)).toMatchObject({ attributes: { [cc]: "CC-100", [grade]: 3 } });
    expect(await find("attr2")).toHaveLength(0);
    expect(await find("attr3")).toHaveLength(0);

    const tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const provenance = await fieldProvenanceOf(tenantId, one.id);
    expect(provenance[`attributes.${cc}`]).toMatchObject({ sourceId, priority: 10 });

    // The source owns what it maps: a change at the source is applied.
    const again = await runCsv(request, sourceId, [header, `A1,E2E Attr One ${stamp},${mail("attr1")},CC-300,3`].join("\n"), "partial");
    expect(again).toMatchObject({ updatedCount: 1 });
    expect(await identity(request, one.id)).toMatchObject({ attributes: { [cc]: "CC-300", [grade]: 3 } });
  });

  test.afterAll(async ({ browser }) => {
    // Retired, so they never appear on other tests' forms.
    const ctx = await browser.newContext({ storageState: authFile("adminOne") });
    for (const id of defIds) await ctx.request.patch(`/api/v1/identities/attributes/${id}`, { data: { active: false } });
    await ctx.close();
  });
});

test.describe.serial("identity sources — unlink with undo (WID-H01)", () => {
  test.use({ storageState: authFile("adminOne") });
  let personId = "";
  let srcId = "";

  test("unlinking a wrong match restores what it changed, keeps what changed since, and is never re-matched by itself", async ({ request }) => {
    test.setTimeout(150_000);
    personId = await createPerson(request, `E2E Unlink ${stamp}`, mail("unlink"));
    expect((await request.patch(`/api/v1/identities/${personId}`, { data: { location: "Pune" } })).status()).toBe(200);
    srcId = await createSource(request, { name: `E2E Unlink HR ${stamp}`, authoritative: true, priority: 10, authoritativeFields: ["department", "title"] });

    // A record matched by email, but it is not this person.
    const record = csv([["U1", `E2E Unlink ${stamp}`, mail("unlink"), "Finance", "Analyst", "", "active"]]);
    expect(await runCsv(request, srcId, record, "partial")).toMatchObject({ updatedCount: 1, pendingCount: 0 });
    expect(await identity(request, personId)).toMatchObject({ department: "Finance", title: "Analyst", location: "Pune" });

    // A person corrects the title by hand afterwards.
    expect((await request.patch(`/api/v1/identities/${personId}`, { data: { title: "Lead" } })).status()).toBe(200);

    const res = await request.post(`/api/v1/integrations/identity-sources/${srcId}/unlink`, { data: { externalId: "U1" } });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).data).toMatchObject({ identityId: personId, restored: ["department"], kept: ["title"] });
    expect(await identity(request, personId)).toMatchObject({ department: null, title: "Lead", location: "Pune" });
    const again = await request.post(`/api/v1/integrations/identity-sources/${srcId}/unlink`, { data: { externalId: "U1" } });
    expect(again.status()).toBe(404);

    // The next run does not link it back by itself: it waits for a person.
    expect(await runCsv(request, srcId, record, "partial")).toMatchObject({ updatedCount: 0, createdCount: 0, pendingCount: 1 });
    expect(await identity(request, personId)).toMatchObject({ department: null });
    const pending = (await (await request.get(`/api/v1/integrations/correlations?sourceId=${srcId}`)).json()).data as { id: string; externalId: string; candidateIdentityIds: string[]; reason: string }[];
    const held = pending.find((p) => p.externalId === "U1");
    expect(held).toMatchObject({ candidateIdentityIds: [personId], reason: expect.stringMatching(/unlinked from/) });

    // A person may link it back: the undo of the unlink.
    const link = await request.post(`/api/v1/integrations/correlations/${held!.id}`, { data: { action: "link", identityId: personId } });
    expect(link.status(), await link.text()).toBe(200);
    expect(await identity(request, personId)).toMatchObject({ department: "Finance" });
    expect(await runCsv(request, srcId, record, "partial")).toMatchObject({ pendingCount: 0 });
  });

  test("another organization cannot unlink it, and a read-only member may not unlink", async ({ browser }) => {
    for (const who of ["adminTwo", "readOnly"] as const) {
      const ctx = await browser.newContext({ storageState: authFile(who) });
      const res = await ctx.request.post(`/api/v1/integrations/identity-sources/${srcId}/unlink`, { data: { externalId: "U1" } });
      expect([403, 404]).toContain(res.status());
      await ctx.close();
    }
  });
});

test.describe("default ID role for new people (owner decision 2026-10-14)", () => {
  test.use({ storageState: authFile("adminOne") });

  test("new people from the HR import are invited with the source's default ID role; the administrator role and other organizations are refused", async ({ request, browser }) => {
    test.setTimeout(90_000);
    const id = await createSource(request, { name: `E2E default ID role ${stamp}`, authoritative: true, priority: 10 });
    const set = (ctx: APIRequestContext, role: string | null) => ctx.put(`/api/v1/integrations/identity-sources/${id}/default-id-role`, { data: { role } });

    expect((await set(request, "TENANT_SUPER_ADMIN")).status()).toBe(400);
    expect((await set(request, "NO_SUCH_ROLE")).status()).toBe(400);
    const ok = await set(request, "READ_ONLY");
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).data.defaultIdRole).toBe("READ_ONLY");
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect([403, 404]).toContain((await set(ro.request, null)).status());
    await ro.close();
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect([403, 404]).toContain((await set(two.request, "READ_ONLY")).status());
    await two.close();

    const email = mail("joiner");
    const run = await runCsv(request, id, csv([["J1", `E2E Joiner ${stamp}`, email, "Finance", "Analyst", "", "active"]]));
    expect(run.createdCount).toBe(1);

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const { data: user } = await db.from("users").select("id").eq("email", email).single();
    const { data: membership } = await db.from("tenant_memberships").select("status").eq("tenant_id", tenantId).eq("user_id", user!.id).single();
    expect(membership!.status).toBe("invited");
    const { data: roles } = await db.from("user_roles").select("roles(name)").eq("tenant_id", tenantId).eq("user_id", user!.id);
    expect((roles ?? []).map((r) => (r.roles as unknown as { name: string }).name)).toEqual(["READ_ONLY"]);
    const { data: audit } = await db.from("audit_logs").select("metadata").eq("tenant_id", tenantId).eq("action", "user.invited").eq("object_id", user!.id);
    expect(audit?.some((a) => (a.metadata as { via?: string }).via === "identity_source")).toBe(true);

    // Cleared: the next new person gets no WonderID access.
    expect((await set(request, null)).status()).toBe(200);
    const second = mail("joiner2");
    await runCsv(request, id, csv([["J2", `E2E Joiner Two ${stamp}`, second, "Finance", "Analyst", "", "active"]]), "partial");
    const { data: none } = await db.from("users").select("id").eq("email", second).maybeSingle();
    expect(none).toBeNull();
  });
});
