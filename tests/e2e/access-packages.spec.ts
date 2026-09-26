import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * ACCESS-P0-20 — access packages against the real app and database
 * (spec §12.3):
 * - a package goes live only with contents on live applications and an
 *   owner; its policy controls who can discover and request it;
 * - a request goes through the approval engine (manager, then the package
 *   owner) and, approved, assigns every included resource as a work item;
 * - a failed item leaves the assignment partially failed and visible until
 *   it is fixed;
 * - expiry and revocation turn granted items into revocation work;
 * - changing a package's contents invalidates waiting approvals;
 * - an access manager can assign a package directly, to an AI agent too.
 * Other organizations and read-only roles see and change nothing.
 *
 * Setup without a product screen of its own (the requester's manager, an
 * expiry date in the past) uses the service role, as the seeding helpers do.
 */

const stamp = Date.now();
const ids = { app: "", app2: "", reader: "", writer: "", pkg: "", finance: "", agentPkg: "", requester: "", iam: "", readOnly: "", agent: "", request: "", assignment: "", agentAssignment: "" };
let tenantId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function identityOf(email: string): Promise<string> {
  const { data, error } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("identity_type", "HUMAN").eq("email", email).limit(1).single();
  if (error || !data) throw new Error(`no identity for ${email}: ${error?.message}`);
  return data.id as string;
}

/** A live application: registered, its entitlements listed (validation needs them), onboarded and promoted. */
async function liveApp(request: APIRequestContext, browser: Browser, name: string, entitlements: [string, string][]): Promise<{ id: string; entitlementIds: string[] }> {
  const id = (await (await request.post("/api/v1/access/applications", { data: { name, appType: "saas", riskLevel: "low", dataClassification: "internal" } })).json()).data.id as string;
  const entitlementIds: string[] = [];
  for (const [entName, privilegeLevel] of entitlements) {
    const res = await request.post(`/api/v1/access/applications/${id}/entitlements`, { data: { name: entName, dataClassification: "internal", privilegeLevel } });
    entitlementIds.push((await res.json()).data.id as string);
  }
  const owner = (await (await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Pkg Owner ${stamp}-${id.slice(0, 4)}` } })).json()).data.id;
  expect((await request.patch(`/api/v1/access/applications/${id}`, { data: { businessOwnerIdentityId: owner, technicalOwnerIdentityId: owner } })).status()).toBe(200);
  const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${id}/onboarding`, { data });
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
  return { id, entitlementIds };
}

type Assignment = { id: string; identityId: string; status: string; items: { id: string; entitlementName: string | null; applicationId: string; status: string; detail: string | null }[] };
const assignments = async (ctx: APIRequestContext, packageId: string): Promise<Assignment[]> => (await (await ctx.get(`/api/v1/access/packages/${packageId}/assignments`)).json()).data;
const item = (ctx: APIRequestContext, itemId: string, status: string, detail?: string) => ctx.post(`/api/v1/access/package-assignment-items/${itemId}`, { data: { status, detail } });
const decide = (ctx: APIRequestContext, id: string, decision: string) => ctx.post(`/api/v1/access/requests/${id}/decision`, { data: { decision } });

test.describe.serial("access packages", () => {
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
    if (ids.requester) await db().from("identities").update({ manager_identity_id: null }).eq("tenant_id", tenantId).eq("id", ids.requester);
    for (const c of contexts) await c.close();
  });

  test("setup: live applications; a package goes live only with contents and an owner", async ({ request, browser }) => {
    test.setTimeout(150_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    ids.requester = await identityOf(TEST_USERS.requester.email);
    ids.iam = await identityOf(TEST_USERS.iamAdminOne.email);
    ids.readOnly = await identityOf(TEST_USERS.readOnly.email);
    await db().from("identities").update({ manager_identity_id: ids.iam }).eq("tenant_id", tenantId).eq("id", ids.requester);
    // An AI agent, live: registered through the app, its lifecycle set active (its identity follows).
    const agentRes = await request.post("/api/v1/agents", { data: { agentName: `e2e-pkg-agent-${stamp}`, agentType: "automation", purpose: "ACCESS-P0-20" } });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const agentId = (await agentRes.json()).data.id as string;
    await db().from("agents").update({ lifecycle_state: "ACTIVE" }).eq("tenant_id", tenantId).eq("id", agentId);
    const { data: agent } = await db().from("identities").select("id, status").eq("tenant_id", tenantId).eq("agent_id", agentId).single();
    expect(agent?.status).toBe("active");
    ids.agent = agent!.id as string;

    const live = await liveApp(request, browser, `E2E Pkg App ${stamp}`, [
      ["Reader", "standard"],
      ["Writer", "elevated"],
    ]);
    ids.app = live.id;
    [ids.reader, ids.writer] = live.entitlementIds;
    const bare = (await (await request.post("/api/v1/access/applications", { data: { name: `E2E Pkg Bare ${stamp}` } })).json()).data.id as string;

    expect((await request.post("/api/v1/access/packages", { data: { name: `E2E Pkg ${stamp}`, eligibleIdentityTypes: [] } })).status()).toBe(400);
    expect((await ro.post("/api/v1/access/packages", { data: { name: `E2E Pkg ro ${stamp}` } })).status()).toBe(403);
    const created = await request.post("/api/v1/access/packages", {
      data: { name: `E2E Pkg Analyst ${stamp}`, description: "Reporting analyst", eligibleIdentityTypes: ["HUMAN"], approval: "manager_and_owner", approvalMode: "sequential", maxDurationDays: 90, defaultDurationDays: 30 },
    });
    expect(created.status(), await created.text()).toBe(201);
    ids.pkg = (await created.json()).data.id;
    expect((await request.post("/api/v1/access/packages", { data: { name: `E2E Pkg Analyst ${stamp}` } })).status()).toBe(409);

    const activate = () => request.patch(`/api/v1/access/packages/${ids.pkg}`, { data: { status: "active" } });
    expect((await (await activate()).json()).error.code).toBe("PACKAGE_EMPTY");
    expect((await (await request.post(`/api/v1/access/packages/${ids.pkg}/resources`, { data: { applicationId: bare } })).json()).error.code).toBe("APPLICATION_NOT_LIVE");
    for (const entitlementId of [ids.reader, ids.writer]) {
      expect((await request.post(`/api/v1/access/packages/${ids.pkg}/resources`, { data: { applicationId: ids.app, entitlementId } })).status()).toBe(201);
    }
    expect((await request.post(`/api/v1/access/packages/${ids.pkg}/resources`, { data: { applicationId: ids.app, entitlementId: ids.reader } })).status()).toBe(409);
    expect((await (await activate()).json()).error.code).toBe("PACKAGE_UNOWNED");
    expect((await request.patch(`/api/v1/access/packages/${ids.pkg}`, { data: { ownerIdentityId: ids.readOnly } })).status()).toBe(200);
    expect((await activate()).status()).toBe(200);

    // Two more: one for a department the requester is not in; one for AI agents only.
    const finance = await request.post("/api/v1/access/packages", { data: { name: `E2E Pkg Finance ${stamp}`, eligibleIdentityTypes: ["HUMAN"], eligibleDepartments: ["Finance Ops"], ownerIdentityId: ids.readOnly } });
    ids.finance = (await finance.json()).data.id;
    await request.post(`/api/v1/access/packages/${ids.finance}/resources`, { data: { applicationId: ids.app, entitlementId: ids.reader } });
    expect((await request.patch(`/api/v1/access/packages/${ids.finance}`, { data: { status: "active" } })).status()).toBe(200);
    const agents = await request.post("/api/v1/access/packages", { data: { name: `E2E Pkg Agents ${stamp}`, eligibleIdentityTypes: ["AI_AGENT"], requestable: false, ownerIdentityId: ids.readOnly, maxDurationDays: 30 } });
    ids.agentPkg = (await agents.json()).data.id;
    await request.post(`/api/v1/access/packages/${ids.agentPkg}/resources`, { data: { applicationId: ids.app, entitlementId: ids.reader } });
    expect((await request.patch(`/api/v1/access/packages/${ids.agentPkg}`, { data: { status: "active" } })).status()).toBe(200);
  });

  test("the package's policy decides who can discover it", async () => {
    // Of the three, the requester (a person with no department) discovers only the one meant for them.
    const found = (await (await requester.get(`/api/v1/access/packages?q=${stamp}`)).json()).data as { id: string }[];
    expect(found.map((p) => p.id)).toEqual([ids.pkg]);
    expect((await requester.get(`/api/v1/access/packages/${ids.finance}`)).status()).toBe(404);
    expect((await requester.get(`/api/v1/access/packages/${ids.agentPkg}`)).status()).toBe(404);
    expect((await requester.post(`/api/v1/access/packages/${ids.finance}/requests`, { data: { justification: "Month-end reporting" } })).status()).toBe(403);
    expect((await requester.get("/api/v1/access/packages?view=manage")).status()).toBe(403);
  });

  test("requested, approved by the manager then the owner, and assigned item by item", async ({ request }) => {
    expect((await requester.post(`/api/v1/access/packages/${ids.pkg}/requests`, { data: { justification: "short" } })).status()).toBe(400);
    expect((await requester.post(`/api/v1/access/packages/${ids.pkg}/requests`, { data: { justification: "Quarterly reporting", durationDays: 120 } })).status()).toBe(400);
    const res = await requester.post(`/api/v1/access/packages/${ids.pkg}/requests`, { data: { justification: "Quarterly reporting" } });
    expect(res.status(), await res.text()).toBe(201);
    const r = (await res.json()).data;
    ids.request = r.id;
    expect(r).toMatchObject({ status: "pending", accessPackageId: ids.pkg, applicationId: null, riskLevel: "high", durationDays: 30 });
    const dup = await requester.post(`/api/v1/access/packages/${ids.pkg}/requests`, { data: { justification: "Quarterly reporting again" } });
    expect((await dup.json()).meta.duplicate).toBe(true);

    const chain = (await (await request.get(`/api/v1/access/requests/${r.id}`)).json()).data;
    expect(chain.packageName).toBe(`E2E Pkg Analyst ${stamp}`);
    expect(chain.steps.map((s: { stage: number; approverKind: string }) => [s.stage, s.approverKind])).toEqual([
      [1, "manager"],
      [2, "package_owner"],
    ]);
    expect((await (await decide(iam, r.id, "approved")).json()).data.approvalStage).toBe(2);
    expect((await (await decide(ro, r.id, "approved")).json()).data.status).toBe("approved");

    const [a] = await assignments(request, ids.pkg);
    ids.assignment = a.id;
    expect(a).toMatchObject({ identityId: ids.requester, status: "provisioning" });
    expect(a.items.map((i) => [i.entitlementName, i.status])).toEqual([
      ["Reader", "pending"],
      ["Writer", "pending"],
    ]);
    // Holders: the requester sees their own; the package's owner (read-only otherwise) sees its holders.
    expect((await assignments(requester, ids.pkg)).map((x) => x.id)).toEqual([a.id]);
    expect((await assignments(ro, ids.pkg)).map((x) => x.id)).toEqual([a.id]);
    // Someone who neither holds nor owns the Finance package sees none of its holders.
    expect(await assignments(requester, ids.finance)).toEqual([]);
    // Holding it, the requester cannot ask again.
    expect((await (await requester.post(`/api/v1/access/packages/${ids.pkg}/requests`, { data: { justification: "Quarterly reporting" } })).json()).error.code).toBe("ALREADY_ASSIGNED");
  });

  test("a failed item leaves the assignment partially failed, visibly, until it is fixed", async ({ request }) => {
    const [a] = await assignments(request, ids.pkg);
    const reader = a.items.find((i) => i.entitlementName === "Reader")!;
    const writer = a.items.find((i) => i.entitlementName === "Writer")!;
    expect((await item(ro, reader.id, "fulfilled")).status()).toBe(403);
    expect((await item(iam, reader.id, "fulfilled")).status()).toBe(200);
    expect((await item(iam, writer.id, "failed")).status()).toBe(400);
    const failed = await item(iam, writer.id, "failed", "Target system refused the group change");
    expect((await failed.json()).data).toMatchObject({ status: "partially_failed" });
    expect((await item(iam, reader.id, "failed", "late")).status()).toBe(409);
    expect((await (await item(iam, writer.id, "fulfilled")).json()).data.status).toBe("active");
  });

  test("changing what a package includes invalidates waiting approvals", async ({ request }) => {
    const res = await request.post(`/api/v1/access/packages/${ids.pkg}/requests`, { data: { justification: "Covering the reporting desk" } });
    const id = (await res.json()).data.id as string;
    const writerRes = (await (await request.get(`/api/v1/access/packages/${ids.pkg}`)).json()).data.resources.find((r: { entitlementId: string }) => r.entitlementId === ids.writer);
    expect((await request.delete(`/api/v1/access/packages/${ids.pkg}/resources/${writerRes.id}`)).status()).toBe(200);
    const stale = await decide(iam, id, "approved");
    expect((await stale.json()).error.code).toBe("APPROVAL_INVALIDATED");
    // Put it back and withdraw the request.
    expect((await request.post(`/api/v1/access/packages/${ids.pkg}/resources`, { data: { applicationId: ids.app, entitlementId: ids.writer } })).status()).toBe(201);
    expect((await request.post(`/api/v1/access/requests/${id}/cancel`)).status()).toBe(200);
  });

  test("an access manager assigns directly, to an AI agent; expiry and revocation create removal work", async ({ request }) => {
    expect((await ro.post(`/api/v1/access/packages/${ids.agentPkg}/assignments`, { data: { identityId: ids.agent, justification: "Agent needs to read reports" } })).status()).toBe(403);
    expect((await (await request.post(`/api/v1/access/packages/${ids.agentPkg}/assignments`, { data: { identityId: ids.requester, justification: "Wrong identity type here" } })).json()).error.code).toBe("NOT_ELIGIBLE");
    const direct = await request.post(`/api/v1/access/packages/${ids.agentPkg}/assignments`, { data: { identityId: ids.agent, justification: "Agent needs to read reports", durationDays: 7 } });
    expect(direct.status(), await direct.text()).toBe(201);
    const a = (await direct.json()).data as Assignment;
    ids.agentAssignment = a.id;
    // Not theirs and not their package: the requester cannot see it.
    expect((await requester.get(`/api/v1/access/package-assignments/${a.id}`)).status()).toBe(404);
    expect(await assignments(requester, ids.agentPkg)).toEqual([]);
    expect((await item(iam, a.items[0].id, "fulfilled")).status()).toBe(200);

    // The end date passes: expired, and what was granted is now work to remove.
    await db().from("access_package_assignments").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("tenant_id", tenantId).eq("id", a.id);
    const expired = (await (await request.get(`/api/v1/access/package-assignments/${a.id}`)).json()).data as Assignment;
    expect(expired.status).toBe("expired");
    expect(expired.items[0].status).toBe("revoke_pending");
    expect((await (await item(iam, expired.items[0].id, "revoked")).json()).data.items[0].status).toBe("revoked");

    // Revoking the requester's assignment: both granted items become removal work.
    expect((await request.post(`/api/v1/access/package-assignments/${ids.assignment}/revoke`, { data: { reason: "x" } })).status()).toBe(400);
    const revoked = await request.post(`/api/v1/access/package-assignments/${ids.assignment}/revoke`, { data: { reason: "Moved to another team" } });
    const rv = (await revoked.json()).data as Assignment;
    expect(rv.status).toBe("revoked");
    expect(rv.items.map((i) => i.status)).toEqual(["revoke_pending", "revoke_pending"]);
    expect((await request.post(`/api/v1/access/package-assignments/${ids.assignment}/revoke`, { data: { reason: "Moved to another team" } })).status()).toBe(409);
  });

  test("the package screens", async ({ page, browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("requester") });
    const rp = await ctx.newPage();
    await rp.goto(`/access/packages?q=${stamp}`);
    await expect(rp.getByRole("heading", { level: 1, name: "Access packages" })).toBeVisible();
    await rp.getByRole("link", { name: "View and request" }).click();
    await expect(rp.getByRole("heading", { level: 1, name: `E2E Pkg Analyst ${stamp}` })).toBeVisible();
    await expect(rp.getByText("Eligible", { exact: true })).toBeVisible();
    await expect(rp.getByText("What it includes")).toBeVisible();
    await expect(rp.getByRole("button", { name: "Request package" })).toBeVisible();
    await ctx.close();

    await page.goto(`/access/packages/${ids.pkg}`);
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(page.getByText("To be removed").first()).toBeVisible();
    await page.goto("/access/packages?view=manage");
    await expect(page.getByRole("link", { name: "Manage" })).toHaveAttribute("aria-current", "page");
  });

  test("another organization sees and changes none of it", async ({ browser }) => {
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const t = two.request;
    expect((await t.get(`/api/v1/access/packages/${ids.pkg}`)).status()).toBe(404);
    expect((await t.post(`/api/v1/access/packages/${ids.pkg}/requests`, { data: { justification: "Cross-tenant attempt" } })).status()).toBe(404);
    expect((await t.patch(`/api/v1/access/packages/${ids.pkg}`, { data: { status: "retired" } })).status()).toBe(404);
    expect((await t.post(`/api/v1/access/packages/${ids.pkg}/resources`, { data: { applicationId: ids.app } })).status()).toBe(404);
    expect((await (await t.get(`/api/v1/access/packages/${ids.pkg}/assignments`)).json()).data).toEqual([]);
    expect((await t.get(`/api/v1/access/package-assignments/${ids.assignment}`)).status()).toBe(404);
    expect((await t.post(`/api/v1/access/package-assignments/${ids.agentAssignment}/revoke`, { data: { reason: "Cross-tenant attempt" } })).status()).toBe(404);
    const managed = (await (await t.get("/api/v1/access/packages?view=manage")).json()).data as { id: string }[];
    expect(managed.some((p) => p.id === ids.pkg)).toBe(false);
    await two.close();
  });
});
