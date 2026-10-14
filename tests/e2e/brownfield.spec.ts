import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";
import { replaceIntegrationObjects, seedIntegrationWithAccounts, type SeedAccount } from "./support/seedIntegrationAccounts";
import { accessFindings, entitlementIdByRef, grantsOf, ledgerFor } from "./support/readAccessGovernance";

/**
 * QA-P0-22 — a brownfield organization brought under governance end to end,
 * through the app's own routes. An HR file and a directory feed people in
 * (one match is ambiguous, the two sources disagree on one field); an
 * application that has run for years without WonderID arrives through its
 * connector with legitimate, privileged, stale, orphan, ambiguous, service,
 * agent and external accounts and grants that carry no request id. Then:
 * the first reconciliation is the baseline (legacy, no findings) → a person
 * requests more → the owner approves → a fulfilment task → the source shows
 * it → verified → stale access is removed the same way → another
 * organization sees none of it.
 *
 * Then the people's access is certified (COMPLIANCE-P0-10): a campaign over
 * the application, reviewed by its owner; certified access stays, revoked
 * access becomes an approved removal followed like any other.
 */

const stamp = Date.now();
const mail = (who: string) => `e2e-bf-${who}-${stamp}@example.test`;
const CLIENT_ID = `e2e-bf-client-${stamp}`;

const MAPPINGS = [
  { source: "employee_id", target: "externalId" },
  { source: "full_name", target: "displayName" },
  { source: "email", target: "email" },
  { source: "department", target: "department" },
  { source: "title", target: "title" },
  { source: "status", target: "status" },
];
const csv = (rows: string[][]) => ["employee_id,full_name,email,department,title,status", ...rows.map((r) => r.join(","))].join("\n");

const ACCOUNTS: SeedAccount[] = [
  { externalId: "uid=bea", raw: { id: "bea", username: "bea", email: mail("bea"), lastLogin: new Date().toISOString() } },
  { externalId: "uid=bea-admin", raw: { id: "bea-admin", username: "bea-admin", email: mail("bea"), privileged: true } },
  { externalId: "uid=olu", raw: { id: "olu", username: "olu", email: mail("olu"), lastLogin: "2024-01-15T09:00:00Z" } },
  { externalId: "uid=ghost", raw: { id: "ghost", username: "ghost", email: mail("ghost") } },
  { externalId: "uid=twin", raw: { id: "twin", username: "twin", email: mail("twin") } },
  { externalId: "uid=svc", raw: { id: "svc-batch", username: "svc-batch", accountType: "service", owner: mail("bea") } },
  { externalId: "uid=bot", raw: { id: "bf-bot", username: "bf-bot", accountType: "service", clientId: CLIENT_ID } },
  { externalId: "uid=ext", raw: { id: "ext", username: "ext", email: mail("ext") } },
];
const ENTITLEMENTS: SeedAccount[] = [
  { externalId: "cn=finance", raw: {}, normalized: { name: "Finance" } },
  { externalId: "cn=ops", raw: {}, normalized: { name: "Ops" } },
  { externalId: "cn=admin", raw: {}, normalized: { name: "Admin" } },
];
const grant = (account: string, entitlement: string): SeedAccount => ({ externalId: `${account}|${entitlement}`, raw: {}, normalized: { accountExternalId: account, entitlementExternalId: entitlement } });
// Years of access granted outside any request: none of it has a request id.
const LEGACY = [
  grant("uid=bea", "cn=finance"),
  grant("uid=bea-admin", "cn=admin"),
  grant("uid=olu", "cn=finance"),
  grant("uid=ghost", "cn=ops"),
  grant("uid=svc", "cn=ops"),
  grant("uid=bot", "cn=finance"),
  grant("uid=ext", "cn=finance"),
];

let tenantId = "";
let appId = "";
let integrationId = "";
let iamIdentityId = "";
let beaId = "";
let oluId = "";
let extId = "";
let agentId = "";
let twinIds: string[] = [];
let opsRequestId = "";
let campaignId = "";
type Account = { id: string; externalAccountRef: string; identityId: string | null; agentId: string | null; correlation: string; accountType: string };
const accounts: Record<string, Account> = {};

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function runCsv(request: APIRequestContext, sourceId: string, text: string, mode: "full" | "partial") {
  const res = await request.post(`/api/v1/integrations/identity-sources/${sourceId}/runs`, { data: { kind: "upload", mode, dryRun: false, csvText: text } });
  expect(res.status(), await res.text()).toBe(202);
  const runId = (await res.json()).data.id as string;
  let run: Record<string, unknown> = {};
  await expect
    .poll(
      async () => {
        run = (await (await request.get(`/api/v1/integrations/identity-sources/runs/${runId}`)).json()).data;
        return run.status;
      },
      { timeout: 30_000, intervals: [500, 1000] },
    )
    .toMatch(/succeeded|partial|failed/);
  return run;
}

async function source(request: APIRequestContext, name: string, priority: number) {
  const res = await request.post("/api/v1/integrations/identity-sources", { data: { template: "csv", attributeMappings: MAPPINGS, name, authoritative: true, priority, authoritativeFields: ["department", "title"] } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id as string;
}

async function personByEmail(request: APIRequestContext, email: string) {
  const found = (await (await request.get(`/api/v1/identities?type=HUMAN&q=${encodeURIComponent(email)}`)).json()).data as { id: string }[];
  expect(found).toHaveLength(1);
  return found[0].id;
}

async function loadAccounts(request: APIRequestContext) {
  const res = await request.get(`/api/v1/access/accounts?applicationId=${appId}&view=all`);
  expect(res.status()).toBe(200);
  for (const a of (await res.json()).data as Account[]) accounts[a.externalAccountRef] = a;
}

async function view(request: APIRequestContext, name: string) {
  return ((await (await request.get(`/api/v1/access/accounts?applicationId=${appId}&view=${name}`)).json()).data as Account[]).map((a) => a.externalAccountRef).sort();
}

async function reconcileAccess(request: APIRequestContext) {
  const preview = await request.post(`/api/v1/access/applications/${appId}/access-reconciliations`, { data: { dryRun: true } });
  expect(preview.status(), await preview.text()).toBe(201);
  const applied = await request.post(`/api/v1/access/applications/${appId}/access-reconciliations`, { data: { previewRunId: (await preview.json()).data.id } });
  expect(applied.status(), await applied.text()).toBe(201);
  return (await applied.json()).data.counts as { entitlements: Record<string, number>; grants: Record<string, number> };
}

type RequestView = { request: { status: string }; fulfilment: string; tasks: { id: string; kind: string; status: string }[] };
const requestView = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/v1/access/requests/${id}`)).json()).data as RequestView;

/** The application's owner (the IAM administrator) approves a request that waits for them. */
async function ownerApproves(browser: Browser, id: string) {
  const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
  const res = await iam.request.post(`/api/v1/access/requests/${id}/decision`, { data: { decision: "approved", comment: "QA-P0-22" } });
  expect(res.status(), await res.text()).toBe(200);
  await iam.close();
}

test.describe.serial("brownfield: HR to verified access", () => {
  test.use({ storageState: authFile("adminOne") });

  test("people: the HR file creates them, holds an ambiguous match, and the directory's disagreement is listed, not applied", async ({ request }) => {
    test.setTimeout(90_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const twin = async () => {
      const res = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E BF Twin ${stamp}`, email: mail("twin") } });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data.id as string;
    };
    twinIds = [await twin(), await twin()];

    const hr = await source(request, `E2E BF HR ${stamp}`, 10);
    const run = await runCsv(
      request,
      hr,
      csv([
        ["B1", `E2E BF Bea ${stamp}`, mail("bea"), "Finance", "Analyst", "active"],
        ["B2", `E2E BF Olu ${stamp}`, mail("olu"), "Finance", "Clerk", "active"],
        ["B3", `E2E BF Twin ${stamp}`, mail("twin"), "Sales", "Rep", "active"],
      ]),
      "partial",
    );
    expect(run).toMatchObject({ createdCount: 2, pendingCount: 1 });
    beaId = await personByEmail(request, mail("bea"));
    oluId = await personByEmail(request, mail("olu"));
    const pending = (await (await request.get(`/api/v1/integrations/correlations?sourceId=${hr}`)).json()).data as { externalId: string; candidateIdentityIds: string[] }[];
    expect(pending.find((p) => p.externalId === "B3")?.candidateIdentityIds.sort()).toEqual([...twinIds].sort());

    const dir = await source(request, `E2E BF Directory ${stamp}`, 50);
    await runCsv(request, dir, csv([["D1", `E2E BF Bea ${stamp}`, mail("bea"), "Marketing", "Analyst", "active"]]), "partial");
    expect(((await (await request.get(`/api/v1/identities/${beaId}`)).json()).data as { department: string }).department).toBe("Finance");
    const { data: conflicts } = await db().from("identity_source_conflicts").select("field, kept_value, other_value").eq("identity_id", beaId).is("resolved_at", null);
    expect(conflicts).toEqual([{ field: "department", kept_value: "Finance", other_value: "Marketing" }]);
  });

  test("setup: an external contractor, an agent with a declared identifier, and the application onboarded from its connector", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const ext = await request.post("/api/v1/identities", {
      data: { identityType: "EXTERNAL", displayName: `E2E BF Contractor ${stamp}`, email: mail("ext"), sponsorIdentityId: beaId, organization: "Acme Partners", endDate: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) },
    });
    expect(ext.status(), await ext.text()).toBe(201);
    extId = (await ext.json()).data.id;
    const agent = await request.post("/api/v1/agents", { data: { agentName: `e2e-bf-bot-${stamp}`, agentType: "automation", purpose: "QA-P0-22" } });
    expect(agent.status(), await agent.text()).toBe(201);
    agentId = (await agent.json()).data.id;
    const link = await request.post(`/api/v1/agents/${agentId}/identities`, { data: { identityType: "oauth_client", externalReference: CLIENT_ID, sourceSystem: "e2e-bf", confidence: "confirmed" } });
    expect(link.status(), await link.text()).toBe(201);

    const { data: iamUser } = await db().from("users").select("id").eq("email", TEST_USERS.iamAdminOne.email).single();
    const { data: owner } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", iamUser!.id).limit(1).single();
    iamIdentityId = owner!.id as string;

    integrationId = await seedIntegrationWithAccounts(TENANT_ONE.slug, `E2E BF Connector ${stamp}`, ACCOUNTS);
    await replaceIntegrationObjects(integrationId, tenantId, "entitlement", ENTITLEMENTS);
    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", LEGACY);

    const app = await request.post("/api/v1/access/applications", {
      data: { name: `E2E BF Ledger ${stamp}`, appType: "saas", businessOwnerIdentityId: iamIdentityId, technicalOwnerIdentityId: iamIdentityId, riskLevel: "medium", dataClassification: "internal" },
    });
    expect(app.status(), await app.text()).toBe(201);
    appId = (await app.json()).data.id;
    const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${appId}/onboarding`, { data });
    expect((await onb({ action: "start" })).status()).toBe(200);
    const configured = await onb({
      action: "configure",
      config: {
        integrationId,
        accountIdentifierField: "id",
        correlationAccountField: "email",
        correlationIdentityField: "email",
        entitlementSource: "connector",
        requestPolicy: "owner_approval",
        certificationPolicy: "annual",
        provenanceEnabled: true,
      },
    });
    expect(configured.status(), await configured.text()).toBe(200);
    expect((await (await onb({ action: "validate" })).json()).data.validation.blockingFailures).toEqual([]);
    expect((await (await onb({ action: "simulate" })).json()).data.status).toBe("WAITING_FOR_APPROVAL");
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
    await iam.close();
    expect((await onb({ action: "promote" })).status()).toBe(200);
  });

  test("accounts: each brownfield case lands where it belongs", async ({ request }) => {
    const res = await request.post(`/api/v1/access/applications/${appId}/reconciliations`);
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).data).toMatchObject({ status: "succeeded", sourceAccounts: 8, created: 8, orphan: 1, ambiguous: 1 });
    await loadAccounts(request);

    expect(accounts.bea).toMatchObject({ identityId: beaId, correlation: "correlated", accountType: "standard" });
    expect(accounts["bea-admin"]).toMatchObject({ identityId: beaId, accountType: "privileged" });
    expect(accounts.olu).toMatchObject({ identityId: oluId, correlation: "correlated" });
    expect(accounts.ghost).toMatchObject({ identityId: null, correlation: "orphan" });
    // Two people share the address: nobody is picked for them.
    expect(accounts.twin).toMatchObject({ identityId: null, correlation: "ambiguous" });
    expect(accounts.ext).toMatchObject({ identityId: extId, correlation: "correlated" });
    expect(accounts["bf-bot"]).toMatchObject({ agentId, correlation: "correlated" });
    expect(accounts["svc-batch"]).toMatchObject({ accountType: "service", correlation: "correlated" });
    const svc = (await (await request.get(`/api/v1/identities/${accounts["svc-batch"].identityId}`)).json()).data;
    expect(svc).toMatchObject({ identityType: "SERVICE_ACCOUNT", ownerIdentityId: beaId });

    expect(await view(request, "orphan")).toEqual(["ghost"]);
    expect(await view(request, "ambiguous")).toEqual(["twin"]);
    expect(await view(request, "privileged")).toEqual(["bea-admin"]);
    expect(await view(request, "dormant")).toContain("olu");
    expect(await view(request, "dormant")).not.toContain("bea");
  });

  test("baseline: access without a request id is legacy, with no findings; a re-run changes nothing", async ({ request }) => {
    const counts = await reconcileAccess(request);
    expect(counts.entitlements).toMatchObject({ added: 3 });
    // The ambiguous account carries no grant; every other grant resolves to an account.
    expect(counts.grants).toMatchObject({ added: LEGACY.length, unresolved: 0 });
    const finance = await entitlementIdByRef(tenantId, appId, "cn=finance");
    for (const ref of ["bea", "olu", "ext", "bf-bot"]) {
      expect((await ledgerFor(tenantId, accounts[ref].id)).find((e) => e.entitlementId === finance)?.status, ref).toBe("LEGACY_EXCEPTION");
      expect(await accessFindings(tenantId, accounts[ref].id)).toEqual([]);
    }
    const again = await reconcileAccess(request);
    expect(again.grants).toMatchObject({ added: 0, removed: 0, unchanged: LEGACY.length });
  });

  test("request → owner approval → fulfilment task → the source shows it → verified", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const policy = await request.post("/api/v1/access/request-policies", {
      data: { applicationId: appId, name: `E2E BF Policy ${stamp}`, autoApprove: false, approval: "owner_approval", riskThreshold: "high", allowForOthers: "access_managers" },
    });
    expect([200, 201], await policy.text()).toContain(policy.status());
    const ops = (await entitlementIdByRef(tenantId, appId, "cn=ops"))!;

    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: beaId, applicationId: appId, entitlementId: ops, justification: "Month-end close" } });
    expect(res.status(), await res.text()).toBe(201);
    opsRequestId = (await res.json()).data.id;
    expect((await requestView(request, opsRequestId)).request.status).toBe("pending");
    await ownerApproves(browser, opsRequestId);

    const approved = await requestView(request, opsRequestId);
    expect(approved).toMatchObject({ request: { status: "approved" }, fulfilment: "pending_fulfilment" });
    const [task] = approved.tasks;
    expect(task).toMatchObject({ kind: "grant", status: "open" });
    expect((await request.post(`/api/v1/access/fulfilment-tasks/${task.id}`, { data: { action: "complete" } })).status()).toBe(200);
    expect((await requestView(request, opsRequestId)).fulfilment).toBe("fulfilled_unverified");

    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", [...LEGACY, grant("uid=bea", "cn=ops")]);
    const counts = await reconcileAccess(request);
    expect(counts.grants).toMatchObject({ added: 0, verified: 1 });
    expect((await requestView(request, opsRequestId)).fulfilment).toBe("verified");
    expect((await ledgerFor(tenantId, accounts.bea.id)).find((e) => e.entitlementId === ops)?.status).toBe("VALID");
    expect(await accessFindings(tenantId, accounts.bea.id)).toEqual([]);
  });

  test("stale access is removed the same way and the source confirms it", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const finance = (await entitlementIdByRef(tenantId, appId, "cn=finance"))!;
    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: oluId, applicationId: appId, entitlementId: finance, requestType: "remove", justification: "Unused since 2024" } });
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).data.id as string;
    if ((await requestView(request, id)).request.status === "pending") await ownerApproves(browser, id);
    const removal = await requestView(request, id);
    expect(removal.tasks.map((t) => t.kind)).toEqual(["remove"]);
    expect((await request.post(`/api/v1/access/fulfilment-tasks/${removal.tasks[0].id}`, { data: { action: "complete" } })).status()).toBe(200);

    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", [...LEGACY.filter((g) => g.externalId !== "uid=olu|cn=finance"), grant("uid=bea", "cn=ops")]);
    const counts = await reconcileAccess(request);
    expect(counts.grants).toMatchObject({ revoked: 1 });
    expect((await grantsOf(tenantId, accounts.olu.id)).find((g) => g.entitlementId === finance)?.revokedAt).toBeTruthy();
    expect((await ledgerFor(tenantId, accounts.olu.id)).find((e) => e.entitlementId === finance)?.status).toBe("REVOKED");
    expect((await requestView(request, id)).fulfilment).toBe("verified");
  });

  test("certify: the application owner reviews the people's access; certified stays, revoked becomes an approved removal", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const { data: adminUser } = await db().from("users").select("id").eq("email", TEST_USERS.adminOne.email).single();
    const launched = await request.post("/api/v1/compliance/campaigns", {
      data: { name: `E2E BF Review ${stamp}`, scopeType: "identity_access", scope: { applicationId: appId }, cadence: "one_time", reviewerKind: "application_owner", reviewerId: adminUser!.id },
    });
    expect(launched.status(), await launched.text()).toBe(200);
    campaignId = (await launched.json()).data.id;
    type Item = { id: string; identityId: string | null; accountId: string | null; reviewerId: string; snapshot: { accessGrant: { entitlementName: string } } };
    let items: Item[] = [];
    await expect
      .poll(async () => {
        items = (await (await request.get(`/api/v1/compliance/campaigns/${campaignId}/items`)).json()).data as Item[];
        return items.length;
      }, { timeout: 30_000 })
      .toBe(5);
    // Bea's three grants, the contractor's and the service account's; not the orphan, the revoked one or the agent's.
    const { data: iamUser } = await db().from("users").select("id").eq("email", TEST_USERS.iamAdminOne.email).single();
    expect(items.every((i) => i.reviewerId === iamUser!.id && i.identityId)).toBe(true);
    expect(items.map((i) => i.accountId)).not.toContain(accounts.ghost.id);
    expect(items.map((i) => i.accountId)).not.toContain(accounts.olu.id);

    const decide = (ctx: APIRequestContext, id: string, decision: string) => ctx.post(`/api/v1/compliance/items/${id}/decisions`, { data: { decision, justification: "QA-P0-22 review" } });
    const bea = items.find((i) => i.accountId === accounts.bea.id && i.snapshot.accessGrant.entitlementName === "Finance")!;
    const ext = items.find((i) => i.accountId === accounts.ext.id)!;
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await decide(ro.request, bea.id, "approve")).status()).toBe(403);
    await ro.close();

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await decide(iam.request, bea.id, "approve")).status()).toBe(200);
    const revoked = await decide(iam.request, ext.id, "revoke");
    expect(revoked.status(), await revoked.text()).toBe(200);
    const removalId = (await revoked.json()).data.remediationId as string;
    await iam.close();
    const removal = await requestView(request, removalId);
    expect(removal.request.status).toBe("approved");
    expect(removal.tasks.map((t) => t.kind)).toEqual(["remove"]);
  });

  test("another organization sees none of it", async ({ browser }) => {
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const listed = await two.request.get(`/api/v1/access/accounts?applicationId=${appId}&view=all`);
    expect(listed.status() === 200 ? (await listed.json()).data : []).toEqual([]);
    expect((await two.request.get(`/api/v1/access/requests/${opsRequestId}`)).status()).toBe(404);
    expect((await two.request.get(`/api/v1/identities/${beaId}`)).status()).toBe(404);
    const theirItems = await two.request.get(`/api/v1/compliance/campaigns/${campaignId}/items`);
    expect(theirItems.status() === 200 ? (await theirItems.json()).data : []).toEqual([]);
    await two.close();
  });
});
