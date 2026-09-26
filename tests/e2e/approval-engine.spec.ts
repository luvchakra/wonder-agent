import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * ACCESS-P0-19 — the approval engine against the real app and database:
 * - the chain comes from the request policy: manager then owner in order,
 *   or both at once; the entitlement owner ahead of the application owner;
 *   critical risk adds an access-manager review by someone who has not
 *   already approved;
 * - only the approver a step names (or an access manager, for a step open
 *   to them) decides it, only at its stage; nobody decides a request they
 *   made or that is for them; a named owner needs no approver role;
 * - a request made by the subject's manager goes to access managers;
 * - a change to what was requested invalidates every approval;
 * - an approver who does not decide in time is escalated once, then the
 *   request expires.
 * Other organizations see and decide nothing.
 *
 * Setup that has no product screen of its own (the subject's manager, a
 * privilege change, a due time in the past) is written with the service
 * role, the same way the seeding helpers do; every decision runs through
 * the app.
 */

const stamp = Date.now();
const ids = { app: "", reader: "", admin: "", report: "", viewer: "", exporter: "", auditor: "", requester: "", iam: "", readOnly: "", adminOne: "" };
let tenantId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function identityOf(email: string): Promise<string> {
  const { data, error } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("identity_type", "HUMAN").eq("email", email).limit(1).single();
  if (error || !data) throw new Error(`no identity for ${email}: ${error?.message}`);
  return data.id as string;
}

async function promote(request: APIRequestContext, browser: Browser, id: string, ownerId: string) {
  expect((await request.patch(`/api/v1/access/applications/${id}`, { data: { businessOwnerIdentityId: ownerId, technicalOwnerIdentityId: ownerId } })).status()).toBe(200);
  const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${id}/onboarding`, { data });
  await onb({ action: "start" });
  await onb({
    action: "configure",
    config: { accountIdentifierField: "id", correlationAccountField: "email", correlationIdentityField: "email", entitlementSource: "manual", requestPolicy: "manager_and_owner", certificationPolicy: "annual", provenanceEnabled: true },
  });
  await onb({ action: "validate" });
  await onb({ action: "simulate" });
  const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
  expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
  await iam.close();
  expect((await onb({ action: "promote" })).status()).toBe(200);
}

type Step = { id: string; stage: number; approverKind: string; approverIdentityId: string | null; status: string; reason: string | null; decidedBy: string | null; comment: string | null; escalatedAt: string | null };
type Detail = { request: { id: string; status: string; approvalStage: number | null; riskLevel: string }; steps: Step[] };

const detail = async (ctx: APIRequestContext, id: string): Promise<Detail> => {
  const res = await ctx.get(`/api/v1/access/requests/${id}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data as Detail;
};
const decide = (ctx: APIRequestContext, id: string, decision: string, comment?: string) => ctx.post(`/api/v1/access/requests/${id}/decision`, { data: { decision, comment } });
const submit = (ctx: APIRequestContext, data: Record<string, unknown>) => ctx.post("/api/v1/access/requests", { data });
const live = (d: Detail) => d.steps.filter((s) => s.status !== "invalidated");

test.describe.serial("approval engine", () => {
  // Each step makes many sequential calls against the live database.
  test.describe.configure({ timeout: 90_000 });
  test.use({ storageState: authFile("adminOne") });
  let requester: APIRequestContext;
  let iam: APIRequestContext;
  let ro: APIRequestContext;
  const contexts: { close: () => Promise<void> }[] = [];

  test.beforeAll(async ({ browser }) => {
    for (const [key, set] of [
      ["requester", (c: APIRequestContext) => (requester = c)],
      ["iamAdminOne", (c: APIRequestContext) => (iam = c)],
      ["readOnly", (c: APIRequestContext) => (ro = c)],
    ] as const) {
      const ctx = await browser.newContext({ storageState: authFile(key) });
      contexts.push(ctx);
      set(ctx.request);
    }
  });

  test.afterAll(async () => {
    // The requester's manager is shared test state: put it back.
    if (ids.requester) await db().from("identities").update({ manager_identity_id: null }).eq("tenant_id", tenantId).eq("id", ids.requester);
    for (const c of contexts) await c.close();
  });

  test("setup: a live application, entitlements with policies, a manager and owners", async ({ request, browser }) => {
    test.setTimeout(120_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    ids.requester = await identityOf(TEST_USERS.requester.email);
    ids.iam = await identityOf(TEST_USERS.iamAdminOne.email);
    ids.readOnly = await identityOf(TEST_USERS.readOnly.email);
    ids.adminOne = await identityOf(TEST_USERS.adminOne.email);
    // The IAM admin manages the requester.
    const { error } = await db().from("identities").update({ manager_identity_id: ids.iam }).eq("tenant_id", tenantId).eq("id", ids.requester);
    expect(error).toBeNull();

    const app = await request.post("/api/v1/access/applications", { data: { name: `E2E Appr App ${stamp}`, appType: "saas", riskLevel: "low", dataClassification: "internal" } });
    ids.app = (await app.json()).data.id;
    const ent = async (name: string, privilegeLevel = "standard") =>
      (await (await request.post(`/api/v1/access/applications/${ids.app}/entitlements`, { data: { name, dataClassification: "internal", privilegeLevel } })).json()).data.id as string;
    ids.reader = await ent("Reader");
    ids.admin = await ent("Administrator", "admin");
    ids.report = await ent("Report");
    ids.viewer = await ent("Viewer");
    ids.exporter = await ent("Exporter");
    ids.auditor = await ent("Auditor");
    // The read-only user owns the application: a named owner needs no approver role.
    await promote(request, browser, ids.app, ids.readOnly);

    // The entitlement owner approves ahead of the application owner; only an active person.
    expect((await request.put(`/api/v1/access/entitlements/${ids.report}/owner`, { data: { ownerIdentityId: ids.adminOne } })).status()).toBe(200);
    expect((await ro.put(`/api/v1/access/entitlements/${ids.report}/owner`, { data: { ownerIdentityId: ids.readOnly } })).status()).toBe(403);

    const policy = (data: Record<string, unknown>) => request.post("/api/v1/access/request-policies", { data: { applicationId: ids.app, autoApprove: false, ...data } });
    expect((await policy({ name: "bad", approvalTimeoutDays: 0 })).status()).toBe(400);
    expect((await policy({ name: "bad", approvalMode: "sometimes" })).status()).toBe(400);
    expect((await policy({ name: `E2E Appr App policy ${stamp}`, approval: "manager_and_owner", approvalMode: "sequential", approvalTimeoutDays: 2, onTimeout: "escalate" })).status()).toBe(200);
    expect((await policy({ entitlementId: ids.admin, name: `E2E Appr Admin policy ${stamp}`, approval: "manager_and_owner", approvalMode: "parallel" })).status()).toBe(200);
    expect((await policy({ entitlementId: ids.report, name: `E2E Appr Report policy ${stamp}`, approval: "owner_approval", onTimeout: "expire" })).status()).toBe(200);
  });

  test("in order: the manager, then the owner; nobody else, nobody out of turn, never the requester", async ({ request }) => {
    const res = await submit(requester, { applicationId: ids.app, entitlementId: ids.reader, justification: "Monthly close reporting" });
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).data.id as string;
    let d = await detail(request, id);
    expect(d.request).toMatchObject({ status: "pending", approvalStage: 1 });
    expect(d.steps.map((s) => [s.stage, s.approverKind, s.approverIdentityId, s.status])).toEqual([
      [1, "manager", ids.iam, "pending"],
      [2, "application_owner", ids.readOnly, "waiting"],
    ]);

    // The owner's turn has not come; an access manager who is not named is not an approver; the requester never is.
    expect((await (await decide(ro, id, "approved")).json()).error.code).toBe("NOT_AN_APPROVER");
    expect((await (await decide(request, id, "approved")).json()).error.code).toBe("NOT_AN_APPROVER");
    expect((await (await decide(requester, id, "approved")).json()).error.code).toBe("SELF_APPROVAL");

    const first = await decide(iam, id, "approved", "Needed for the close");
    expect(first.status(), await first.text()).toBe(200);
    expect((await first.json()).data).toMatchObject({ status: "pending", approvalStage: 2 });
    expect((await decide(iam, id, "approved")).status()).toBe(403);
    // The owner sees it waiting for them, and approves.
    const waiting = (await (await ro.get("/api/v1/access/requests?view=waiting")).json()).data as { id: string }[];
    expect(waiting.some((w) => w.id === id)).toBe(true);
    const second = await decide(ro, id, "approved", "Owner agrees");
    expect((await second.json()).data.status).toBe("approved");

    d = await detail(request, id);
    expect(d.steps.map((s) => s.status)).toEqual(["approved", "approved"]);
    expect(d.steps[0].comment).toBe("Needed for the close");
    expect((await (await ro.get("/api/v1/access/requests?view=waiting")).json()).data.some((w: { id: string }) => w.id === id)).toBe(false);
    expect((await decide(ro, id, "rejected")).status()).toBe(409);
  });

  test("at the same time; critical risk adds a second pair of eyes; one rejection closes the request", async ({ request }) => {
    const res = await submit(requester, { applicationId: ids.app, entitlementId: ids.admin, justification: "Break-glass for the migration", durationDays: 7 });
    const id = (await res.json()).data.id as string;
    let d = await detail(request, id);
    expect(d.request.riskLevel).toBe("critical");
    expect(d.steps.map((s) => [s.stage, s.approverKind])).toEqual([
      [1, "manager"],
      [1, "application_owner"],
      [2, "access_managers"],
    ]);

    // Stage 1 in parallel: the owner first, still waiting on the manager.
    expect((await (await decide(ro, id, "approved")).json()).data).toMatchObject({ status: "pending", approvalStage: 1 });
    expect((await (await decide(iam, id, "approved")).json()).data).toMatchObject({ status: "pending", approvalStage: 2 });
    // The manager is an access manager too, but already approved: someone else reviews.
    expect((await (await decide(iam, id, "approved")).json()).error.code).toBe("ALREADY_DECIDED");
    const rejected = await decide(request, id, "rejected", "Break-glass goes through the PAM vault");
    expect((await rejected.json()).data.status).toBe("rejected");
    d = await detail(request, id);
    expect(d.steps.map((s) => s.status)).toEqual(["approved", "approved", "rejected"]);
  });

  test("the entitlement owner decides ahead of the application owner; a request by the manager goes to access managers", async ({ request }) => {
    const report = await submit(requester, { applicationId: ids.app, entitlementId: ids.report, justification: "Quarterly reporting pack" });
    const reportId = (await report.json()).data.id as string;
    const r = await detail(request, reportId);
    expect(r.steps.map((s) => [s.approverKind, s.approverIdentityId])).toEqual([["entitlement_owner", ids.adminOne]]);
    expect((await (await decide(request, reportId, "approved")).json()).data.status).toBe("approved");

    // The manager asks for their report: the manager step cannot be theirs.
    const viewer = await submit(iam, { applicationId: ids.app, entitlementId: ids.viewer, subjectIdentityId: ids.requester, justification: "Joining the reporting team" });
    expect(viewer.status(), await viewer.text()).toBe(201);
    const v = await detail(request, (await viewer.json()).data.id);
    expect(v.steps[0]).toMatchObject({ stage: 1, approverKind: "access_managers" });
    expect(v.steps[0].reason).toMatch(/made this request/);
    // Nor may the person the access is for decide it.
    expect((await (await decide(requester, v.request.id, "approved")).json()).error.code).toBe("SELF_APPROVAL");
  });

  test("a change to what was requested invalidates every approval; the chain starts again", async ({ request }) => {
    const list = (await (await iam.get("/api/v1/access/requests?mine=1")).json()).data as { id: string; entitlementId: string; status: string }[];
    const id = list.find((r) => r.entitlementId === ids.viewer && r.status === "pending")!.id;
    expect((await (await decide(request, id, "approved")).json()).data.approvalStage).toBe(2);

    // The entitlement becomes more privileged after the first approval.
    await db().from("entitlements").update({ privilege_level: "elevated" }).eq("tenant_id", tenantId).eq("id", ids.viewer);
    const stale = await decide(ro, id, "approved");
    expect(stale.status()).toBe(409);
    expect((await stale.json()).error.code).toBe("APPROVAL_INVALIDATED");
    const d = await detail(request, id);
    expect(d.request).toMatchObject({ status: "pending", approvalStage: 1, riskLevel: "high" });
    expect(d.steps.filter((s) => s.status === "invalidated")).toHaveLength(2);
    expect(live(d).map((s) => [s.stage, s.approverKind, s.status])).toEqual([
      [1, "access_managers", "pending"],
      [2, "application_owner", "waiting"],
    ]);
    // Approving again, at the start of the new chain, is allowed.
    expect((await (await decide(request, id, "approved")).json()).data.approvalStage).toBe(2);
  });

  test("an approver who does not decide in time is escalated once; then the request expires", async ({ request }) => {
    const res = await submit(requester, { applicationId: ids.app, entitlementId: ids.exporter, justification: "Export for the auditors" });
    const id = (await res.json()).data.id as string;
    const past = new Date(Date.now() - 60_000).toISOString();
    await db().from("access_request_approvals").update({ due_at: past }).eq("tenant_id", tenantId).eq("request_id", id).eq("status", "pending");
    // Any signed-in view of the request sweeps its organization first.
    let d = await detail(ro, id);
    expect(d.steps[0]).toMatchObject({ stage: 1, approverKind: "access_managers", status: "pending" });
    expect(d.steps[0].escalatedAt).toBeTruthy();
    expect(d.steps[0].reason).toMatch(/escalated to access managers/);
    // Only an access manager can decide it now.
    expect((await (await decide(ro, id, "approved")).json()).error.code).toBe("NOT_AN_APPROVER");

    await db().from("access_request_approvals").update({ due_at: past }).eq("tenant_id", tenantId).eq("request_id", id).eq("status", "pending");
    d = await detail(request, id);
    expect(d.request.status).toBe("expired");
    expect(d.steps.map((s) => s.status)).toEqual(["expired", "skipped"]);
    expect((await decide(request, id, "approved")).status()).toBe(409);
  });

  test("the approver's screens: waiting for you, the chain, a decision with a comment", async ({ browser }) => {
    const res = await submit(requester, { applicationId: ids.app, entitlementId: ids.auditor, justification: "Audit week access" });
    const id = (await res.json()).data.id as string;
    const ctx = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const page = await ctx.newPage();
    await page.goto("/access/requests");
    await expect(page.getByRole("link", { name: "Waiting for you" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("row", { name: /Auditor/ }).getByRole("link", { name: `E2E Appr App ${stamp}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: /E2E Appr App .* Auditor/ })).toBeVisible();
    await expect(page.getByText("Stage 1 · current")).toBeVisible();
    await expect(page.getByText("Deciding now")).toBeVisible();
    await page.getByRole("textbox", { name: "Comment (optional)" }).fill("Fine for the audit week");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved your step. It now waits for stage 2.")).toBeVisible();
    await ctx.close();
    const d = await detail(iam, id);
    expect(d.steps[0]).toMatchObject({ status: "approved", comment: "Fine for the audit week" });
  });

  test("another organization sees and decides none of it", async ({ browser, request }) => {
    const pending = (await (await request.get("/api/v1/access/requests?view=all")).json()).data as { id: string; applicationId: string; status: string }[];
    const id = pending.find((r) => r.applicationId === ids.app && r.status === "pending")!.id;
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.get(`/api/v1/access/requests/${id}`)).status()).toBe(404);
    expect((await decide(two.request, id, "approved")).status()).toBe(404);
    expect((await two.request.put(`/api/v1/access/entitlements/${ids.report}/owner`, { data: { ownerIdentityId: null } })).status()).toBe(404);
    const waiting = (await (await two.request.get("/api/v1/access/requests?view=waiting")).json()).data as { applicationId: string }[];
    expect(waiting.some((w) => w.applicationId === ids.app)).toBe(false);
    await two.close();
  });
});
