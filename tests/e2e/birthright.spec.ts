import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * IDENTITY-P0-18 / ACCESS-P0-20 (owner decision, 13 October 2026) —
 * birthright packages against the real app and database:
 * - turning birthright on takes two administrators; the one who asked
 *   cannot approve;
 * - a joiner from an identity source who is eligible gets the package
 *   assigned at once, with no request; one who is not eligible does not;
 * - changing what the package includes sends it back for approval, and the
 *   person who changed it cannot approve it either;
 * - a read-only member can do none of it;
 * - WID-H09 (owner decision, 13 October 2026): a mover who no longer
 *   qualifies keeps the package for a 14-day review, listed on the
 *   manager's task; someone keeps it, or it is removed at the date.
 * The department is unique to this run, so no other spec's joiners match.
 */

const stamp = Date.now();
const dept = `E2E Birthright ${stamp}`;
const mail = (who: string) => `e2e-birth-${who}-${stamp}@example.test`;
const ids = { app: "", reader: "", writer: "", pkg: "", source: "" };
let tenantId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** A live application with two entitlements (registered, onboarded, approved by a second administrator, promoted). */
async function liveApp(request: APIRequestContext, browser: Browser): Promise<void> {
  ids.app = (await (await request.post("/api/v1/access/applications", { data: { name: `E2E Birthright App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } })).json()).data.id as string;
  for (const [name, level, key] of [["Reader", "standard", "reader"], ["Writer", "standard", "writer"]] as const) {
    const res = await request.post(`/api/v1/access/applications/${ids.app}/entitlements`, { data: { name, dataClassification: "internal", privilegeLevel: level } });
    ids[key] = (await res.json()).data.id as string;
  }
  const owner = (await (await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Birthright Owner ${stamp}` } })).json()).data.id;
  expect((await request.patch(`/api/v1/access/applications/${ids.app}`, { data: { businessOwnerIdentityId: owner, technicalOwnerIdentityId: owner } })).status()).toBe(200);
  const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${ids.app}/onboarding`, { data });
  await onb({ action: "start" });
  await onb({
    action: "configure",
    config: { accountIdentifierField: "id", correlationAccountField: "email", correlationIdentityField: "email", entitlementSource: "manual", requestPolicy: "manager_approval", certificationPolicy: "annual", provenanceEnabled: true },
  });
  await onb({ action: "validate" });
  await onb({ action: "simulate" });
  const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
  expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
  await iam.close();
  expect((await onb({ action: "promote" })).status()).toBe(200);
}

async function importPeople(request: APIRequestContext, rows: string[][]) {
  const csvText = ["id,name,email,department", ...rows.map((r) => r.join(","))].join("\n");
  const res = await request.post(`/api/v1/integrations/identity-sources/${ids.source}/runs`, { data: { kind: "upload", mode: "partial", csvText } });
  expect(res.status(), await res.text()).toBe(202);
  const runId = (await res.json()).data.id as string;
  await expect
    .poll(async () => ((await (await request.get(`/api/v1/integrations/identity-sources/runs/${runId}`)).json()).data as { status: string }).status, { timeout: 30_000 })
    .toMatch(/succeeded|partial|failed/);
}

async function personId(email: string): Promise<string> {
  const { data } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("email", email).single();
  return data!.id as string;
}

const birthright = (ctx: APIRequestContext, action: string) => ctx.post(`/api/v1/access/packages/${ids.pkg}/birthright`, { data: { action } });

test.describe.serial("birthright packages", () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ storageState: authFile("adminOne") });
  let iam: APIRequestContext;
  let ro: APIRequestContext;
  const contexts: { close: () => Promise<void> }[] = [];

  test.beforeAll(async ({ browser }) => {
    for (const [key, set] of [
      ["iamAdminOne", (c: APIRequestContext) => (iam = c)],
      ["readOnly", (c: APIRequestContext) => (ro = c)],
    ] as const) {
      const ctx = await browser.newContext({ storageState: authFile(key) });
      contexts.push(ctx);
      set(ctx.request);
    }
  });

  test.afterAll(async () => {
    // Never leave a birthright package on in the shared organization.
    if (ids.pkg) await db().from("access_packages").update({ birthright_status: "off", birthright_approved_by: null, birthright_approved_at: null }).eq("tenant_id", tenantId).eq("id", ids.pkg);
    for (const c of contexts) await c.close();
  });

  test("turning birthright on takes two administrators", async ({ request, browser }) => {
    test.setTimeout(180_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    await liveApp(request, browser);
    const created = await request.post("/api/v1/access/packages", { data: { name: `E2E Birthright Pkg ${stamp}`, eligibleIdentityTypes: ["HUMAN"], eligibleDepartments: [dept] } });
    expect(created.status(), await created.text()).toBe(201);
    ids.pkg = (await created.json()).data.id as string;
    expect((await request.post(`/api/v1/access/packages/${ids.pkg}/resources`, { data: { applicationId: ids.app, entitlementId: ids.reader } })).status()).toBe(201);
    const owner = (await (await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Birthright Pkg Owner ${stamp}` } })).json()).data.id;
    expect((await request.patch(`/api/v1/access/packages/${ids.pkg}`, { data: { ownerIdentityId: owner, status: "active" } })).status()).toBe(200);

    expect((await birthright(ro, "request")).status()).toBe(403);
    expect((await birthright(request, "approve")).status()).toBe(409); // nothing asked yet
    const asked = await birthright(request, "request");
    expect(asked.status(), await asked.text()).toBe(200);
    expect((await asked.json()).data.birthrightStatus).toBe("pending");
    const self = await birthright(request, "approve");
    expect(self.status()).toBe(403);
    expect((await self.json()).error.code).toBe("FOUR_EYES");
    const approved = await birthright(iam, "approve");
    expect(approved.status(), await approved.text()).toBe(200);
    expect((await approved.json()).data).toMatchObject({ birthrightStatus: "on" });

    // The audit trail has who asked and who approved.
    const { data: audit } = await db().from("audit_logs").select("action").eq("tenant_id", tenantId).eq("object_id", ids.pkg).like("action", "access.package_birthright_%");
    expect((audit ?? []).map((a) => a.action)).toEqual(expect.arrayContaining(["access.package_birthright_requested", "access.package_birthright_approved", "access.package_birthright_refused"]));
  });

  test("an eligible joiner gets it at once, without a request; someone else does not", async ({ request }) => {
    const src = await request.post("/api/v1/integrations/identity-sources", {
      data: {
        name: `E2E Birthright HR ${stamp}`,
        template: "csv",
        attributeMappings: [
          { source: "id", target: "externalId" },
          { source: "name", target: "displayName" },
          { source: "email", target: "email" },
          { source: "department", target: "department" },
        ],
        authoritative: true,
        priority: 10,
        authoritativeFields: ["department"],
      },
    });
    expect(src.status(), await src.text()).toBe(201);
    ids.source = (await src.json()).data.id as string;
    await importPeople(request, [
      ["B1", `E2E Birth Joiner ${stamp}`, mail("joiner"), dept],
      ["B2", `E2E Birth Other ${stamp}`, mail("other"), "Somewhere Else"],
    ]);
    const joiner = await personId(mail("joiner"));
    const other = await personId(mail("other"));
    await expect
      .poll(async () => (await db().from("access_package_assignments").select("identity_id, source, request_id, status").eq("tenant_id", tenantId).eq("package_id", ids.pkg)).data ?? [], { timeout: 20_000 })
      .toEqual([expect.objectContaining({ identity_id: joiner, source: "birthright", request_id: null })]);
    const { data: requests } = await db().from("access_requests").select("id").eq("tenant_id", tenantId).eq("access_package_id", ids.pkg);
    expect(requests ?? []).toHaveLength(0);
    const { data: others } = await db().from("access_package_assignments").select("id").eq("tenant_id", tenantId).eq("identity_id", other);
    expect(others ?? []).toHaveLength(0);
    // The joiner's access is a work item with a pending grant, provisioned and verified like any other.
    const { data: items } = await db().from("access_package_assignment_items").select("id, entitlement_id, access_package_assignments!inner(identity_id)").eq("tenant_id", tenantId).eq("access_package_assignments.identity_id", joiner);
    expect((items ?? []).map((i) => i.entitlement_id)).toEqual([ids.reader]);
    const { data: grants } = await db().from("access_grants").select("entitlement_id, fulfilment_status").eq("tenant_id", tenantId).in("access_package_assignment_item_id", (items ?? []).map((i) => i.id as string));
    expect(grants ?? []).toEqual([expect.objectContaining({ entitlement_id: ids.reader, fulfilment_status: "pending_fulfilment" })]);
  });

  test("changing what it includes sends it back for approval; the person who changed it cannot approve", async ({ request }) => {
    expect((await request.post(`/api/v1/access/packages/${ids.pkg}/resources`, { data: { applicationId: ids.app, entitlementId: ids.writer } })).status()).toBe(201);
    const pkg = (await (await request.get(`/api/v1/access/packages/${ids.pkg}`)).json()).data;
    expect(pkg.birthrightStatus).toBe("pending");
    expect((await birthright(request, "approve")).status()).toBe(403);
    // While it waits, a new joiner gets nothing.
    await importPeople(request, [["B3", `E2E Birth Joiner Two ${stamp}`, mail("joiner2"), dept]]);
    const second = await personId(mail("joiner2"));
    const { data: none } = await db().from("access_package_assignments").select("id").eq("tenant_id", tenantId).eq("identity_id", second);
    expect(none ?? []).toHaveLength(0);
    // One person may turn it off.
    expect((await birthright(request, "off")).status()).toBe(200);
  });

  test("WID-H09: a mover who no longer qualifies has it reviewed: kept, or removed at the date", async ({ request }) => {
    const joiner = await personId(mail("joiner"));
    const assignment = async () =>
      (await db().from("access_package_assignments").select("id, status, review_due_at, review_kept_by, end_reason").eq("tenant_id", tenantId).eq("package_id", ids.pkg).eq("identity_id", joiner).order("created_at").limit(1).single()).data!;
    const move = async (department: string) => importPeople(request, [["B1", `E2E Birth Joiner ${stamp}`, mail("joiner"), department]]);

    // Moves out: the package goes to review, due in 14 days, and the manager's review task lists it.
    await move("Elsewhere");
    await expect.poll(async () => (await assignment()).review_due_at, { timeout: 20_000 }).not.toBeNull();
    const due = new Date((await assignment()).review_due_at as string).getTime();
    expect(Math.round((due - Date.now()) / 86_400_000)).toBe(14);
    const { data: tasks } = await db().from("identity_lifecycle_tasks").select("detail").eq("tenant_id", tenantId).eq("identity_id", joiner).eq("task_type", "review_access").order("created_at", { ascending: false }).limit(1);
    expect((tasks?.[0]?.detail as { birthrightReview?: { packageName: string }[] })?.birthrightReview?.map((r) => r.packageName)).toEqual([`E2E Birthright Pkg ${stamp}`]);

    // A read-only member cannot keep it; an administrator can, and it is no longer under review.
    const id = (await assignment()).id as string;
    expect((await ro.post(`/api/v1/access/package-assignments/${id}/keep`)).status()).toBe(403);
    const kept = await request.post(`/api/v1/access/package-assignments/${id}/keep`);
    expect(kept.status(), await kept.text()).toBe(200);
    expect((await kept.json()).data.reviewDueAt).toBeNull();
    expect((await assignment()).review_kept_by).not.toBeNull();
    expect((await request.post(`/api/v1/access/package-assignments/${id}/keep`)).status()).toBe(409);

    // Moves back (qualifies, nothing to review), then away again: under review once more.
    await move(dept);
    await move("Elsewhere Again");
    await expect.poll(async () => (await assignment()).review_due_at, { timeout: 20_000 }).not.toBeNull();

    // Nobody keeps it: once the date has passed, the next sweep removes it through the normal path.
    await db().from("access_package_assignments").update({ review_due_at: new Date(Date.now() - 60_000).toISOString() }).eq("tenant_id", tenantId).eq("id", id);
    expect((await request.get(`/api/v1/access/packages/${ids.pkg}/assignments`)).status()).toBe(200);
    expect(await assignment()).toMatchObject({ status: "revoked", end_reason: expect.stringContaining("Not kept after the person moved") });
    const { data: audit } = await db().from("audit_logs").select("action").eq("tenant_id", tenantId).eq("object_id", id).like("action", "access.package_mover_review_%");
    expect((audit ?? []).map((a) => a.action)).toEqual(expect.arrayContaining(["access.package_mover_review_opened", "access.package_mover_review_kept", "access.package_mover_review_lapsed"]));
  });
});
