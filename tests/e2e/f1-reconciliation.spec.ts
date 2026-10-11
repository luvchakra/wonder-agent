import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";
import { replaceIntegrationObjects, seedIntegrationWithAccounts, type SeedAccount } from "./support/seedIntegrationAccounts";
import { accessFindings, entitlementIdByRef, grantsOf, ledgerEvents, ledgerFor } from "./support/readAccessGovernance";

/**
 * QA-P0-23 — the F1 reconciliation chain end to end, through the app's own
 * routes, for a person, a service account (owned and unowned) and an AI
 * agent. A connector's staged records are seeded (what a sync leaves
 * behind; a live target is not reachable from the test), then:
 * accounts reconcile (person, non-human identity, agent by declared
 * identifier) → entitlements and access preview and apply → baseline:
 * legacy → a grant added on the target is rogue with one finding → removed
 * at the source, the finding resolves → re-runs change nothing → an
 * unowned service account cannot be a request subject → another
 * organization sees none of it.
 */

const stamp = Date.now();
const mail = (who: string) => `e2e-f1-${who}-${stamp}@example.test`;
const CLIENT_ID = `e2e-f1-client-${stamp}`;
// Unique per run: the unowned queue lists every earlier run's account too.
const LONELY = `svc-lonely-${stamp}`;

const ACCOUNTS: SeedAccount[] = [
  { externalId: "uid=ana", raw: { id: "ana", username: "ana", email: mail("ana") } },
  { externalId: "uid=svc", raw: { id: "svc-backup", username: "svc-backup", accountType: "service", owner: mail("ana") } },
  { externalId: "uid=bot", raw: { id: "finbot", username: "finbot", accountType: "service", clientId: CLIENT_ID } },
  { externalId: "uid=lonely", raw: { id: LONELY, username: LONELY, accountType: "service" } },
];
const ENTITLEMENTS: SeedAccount[] = [
  { externalId: "cn=finance", raw: {}, normalized: { name: "Finance" } },
  { externalId: "cn=ops", raw: {}, normalized: { name: "Ops" } },
];
const grant = (account: string, entitlement: string): SeedAccount => ({ externalId: `${account}|${entitlement}`, raw: {}, normalized: { accountExternalId: account, entitlementExternalId: entitlement } });
const BASE_GRANTS = [grant("uid=ana", "cn=finance"), grant("uid=svc", "cn=ops"), grant("uid=bot", "cn=finance")];

let tenantId = "";
let appId = "";
let integrationId = "";
let anaId = "";
let fulfilmentTaskId = "";
let caraId = "";
let agentId = "";
type Account = { id: string; externalAccountRef: string; identityId: string | null; agentId: string | null; correlation: string; accountType: string };
const accounts: Record<string, Account> = {};

async function loadAccounts(request: APIRequestContext) {
  const res = await request.get(`/api/v1/access/accounts?applicationId=${appId}&view=all`);
  expect(res.status()).toBe(200);
  for (const a of (await res.json()).data as Account[]) accounts[a.externalAccountRef] = a;
}

async function reconcileAccess(request: APIRequestContext) {
  const preview = await request.post(`/api/v1/access/applications/${appId}/access-reconciliations`, { data: { dryRun: true } });
  expect(preview.status(), await preview.text()).toBe(201);
  const previewRun = (await preview.json()).data;
  const applied = await request.post(`/api/v1/access/applications/${appId}/access-reconciliations`, { data: { previewRunId: previewRun.id } });
  expect(applied.status(), await applied.text()).toBe(201);
  const run = (await applied.json()).data;
  // The apply wrote exactly what the preview showed.
  expect(run.counts).toEqual(previewRun.counts);
  return run.counts as { entitlements: Record<string, number>; grants: Record<string, number> };
}

test.describe.serial("F1 reconciliation chain", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: a person, an agent with a declared identifier, connector staging and an onboarded application", async ({ request, browser }) => {
    test.setTimeout(120_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const ana = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E F1 Ana ${stamp}`, email: mail("ana") } });
    expect(ana.status(), await ana.text()).toBe(201);
    anaId = (await ana.json()).data.id;

    const agent = await request.post("/api/v1/agents", { data: { agentName: `e2e-f1-bot-${stamp}`, agentType: "automation", purpose: "QA-P0-23" } });
    expect(agent.status(), await agent.text()).toBe(201);
    agentId = (await agent.json()).data.id;
    const link = await request.post(`/api/v1/agents/${agentId}/identities`, { data: { identityType: "oauth_client", externalReference: CLIENT_ID, sourceSystem: "e2e-f1", confidence: "confirmed" } });
    expect(link.status(), await link.text()).toBe(201);

    integrationId = await seedIntegrationWithAccounts(TENANT_ONE.slug, `E2E F1 Connector ${stamp}`, ACCOUNTS);
    await replaceIntegrationObjects(integrationId, tenantId, "entitlement", ENTITLEMENTS);
    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", BASE_GRANTS);

    const app = await request.post("/api/v1/access/applications", {
      data: { name: `E2E F1 App ${stamp}`, appType: "saas", businessOwnerIdentityId: anaId, technicalOwnerIdentityId: anaId, riskLevel: "medium", dataClassification: "internal" },
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
    const validated = await (await onb({ action: "validate" })).json();
    expect(validated.data.validation.blockingFailures, JSON.stringify(validated.data.validation)).toEqual([]);
    const simulated = await (await onb({ action: "simulate" })).json();
    expect(simulated.data.status, JSON.stringify(simulated.data)).toBe("WAITING_FOR_APPROVAL");
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
    await iam.close();
    expect((await onb({ action: "promote" })).status()).toBe(200);
  });

  test("accounts: a person, a service account owned by the person the source names, an unowned one, and the agent by its declared identifier", async ({ request }) => {
    const res = await request.post(`/api/v1/access/applications/${appId}/reconciliations`);
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).data).toMatchObject({ status: "succeeded", sourceAccounts: 4, created: 4, orphan: 0 });
    await loadAccounts(request);

    expect(accounts.ana).toMatchObject({ identityId: anaId, correlation: "correlated" });
    expect(accounts.finbot).toMatchObject({ agentId, correlation: "correlated" });
    expect(accounts["svc-backup"]).toMatchObject({ correlation: "correlated", accountType: "service" });
    expect(accounts[LONELY]).toMatchObject({ correlation: "correlated", accountType: "service" });

    const svc = (await (await request.get(`/api/v1/identities/${accounts["svc-backup"].identityId}`)).json()).data;
    expect(svc).toMatchObject({ identityType: "SERVICE_ACCOUNT", ownerIdentityId: anaId });
    const lonely = (await (await request.get(`/api/v1/identities/${accounts[LONELY].identityId}`)).json()).data;
    expect(lonely).toMatchObject({ identityType: "SERVICE_ACCOUNT", ownerIdentityId: null });

    // Running it again changes nothing and creates no second identity.
    const again = await request.post(`/api/v1/access/applications/${appId}/reconciliations`);
    expect((await again.json()).data).toMatchObject({ created: 0, updated: 4 });
    const before = accounts["svc-backup"].identityId;
    await loadAccounts(request);
    expect(accounts["svc-backup"].identityId).toBe(before);
  });

  test("an unowned service account waits in the queue and cannot be a request subject", async ({ request, page }) => {
    const refused = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: accounts[LONELY].identityId, applicationId: appId, justification: "QA-P0-23 unowned subject" } });
    expect(refused.status(), await refused.text()).toBe(409);
    expect((await refused.json()).error.code).toBe("SUBJECT_UNOWNED");
    await page.goto("/identities/unowned");
    await expect(page.getByRole("link", { name: LONELY })).toBeVisible();
  });

  test("entitlements and access: the first apply is the baseline, so what it found is legacy; a re-run changes nothing", async ({ request }) => {
    const counts = await reconcileAccess(request);
    expect(counts.entitlements).toMatchObject({ added: 2, removed: 0 });
    expect(counts.grants).toMatchObject({ added: 3, removed: 0, unresolved: 0 });

    const finance = await entitlementIdByRef(tenantId, appId, "cn=finance");
    const ana = await ledgerFor(tenantId, accounts.ana.id);
    expect(ana.find((e) => e.entitlementId === finance)?.status).toBe("LEGACY_EXCEPTION");
    expect(await accessFindings(tenantId, accounts.ana.id)).toEqual([]);

    const again = await reconcileAccess(request);
    expect(again.entitlements).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(again.grants).toMatchObject({ added: 0, removed: 0, restored: 0, unchanged: 3 });
  });

  test("a grant added on the target after the baseline with no approval is rogue, with exactly one finding", async ({ request, page }) => {
    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", [...BASE_GRANTS, grant("uid=ana", "cn=ops")]);
    const counts = await reconcileAccess(request);
    expect(counts.grants).toMatchObject({ added: 1 });
    const ops = await entitlementIdByRef(tenantId, appId, "cn=ops");
    expect((await ledgerFor(tenantId, accounts.ana.id)).find((e) => e.entitlementId === ops)?.status).toBe("ROGUE");
    const findings = await accessFindings(tenantId, accounts.ana.id);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ status: "open", entitlementId: ops });

    // Applying again opens no second finding.
    await reconcileAccess(request);
    expect(await accessFindings(tenantId, accounts.ana.id)).toHaveLength(1);

    // Risk Overview lists it with the agent findings, leading to the account.
    await page.goto("/risk");
    const row = page.getByRole("link", { name: new RegExp(`^${findings[0].title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("href", `/access/accounts/${accounts.ana.id}`);
  });

  test("removed at the source: the grant is marked (not revoked), the ledger records it, the finding resolves", async ({ request }) => {
    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", BASE_GRANTS);
    const counts = await reconcileAccess(request);
    expect(counts.grants).toMatchObject({ removed: 1 });
    const ops = await entitlementIdByRef(tenantId, appId, "cn=ops");
    const gone = (await grantsOf(tenantId, accounts.ana.id)).find((g) => g.entitlementId === ops)!;
    expect(gone.missingFromSourceAt).toBeTruthy();
    expect(gone.revokedAt).toBeNull();
    expect(await ledgerEvents(tenantId, accounts.ana.id)).toContain("missing_from_source");
    const findings = await accessFindings(tenantId, accounts.ana.id);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("resolved");
  });

  test("ACCESS-P0-28: an approved request becomes a pending grant on a placeholder account; marked fulfilled it is unverified; the next reconciliations verify it", async ({ request, page }) => {
    test.setTimeout(120_000);
    const cara = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E F2 Cara ${stamp}`, email: mail("cara") } });
    expect(cara.status(), await cara.text()).toBe(201);
    caraId = (await cara.json()).data.id as string;
    const policy = await request.post("/api/v1/access/request-policies", {
      data: { applicationId: appId, name: `E2E F2 Policy ${stamp}`, autoApprove: true, riskThreshold: "high", maxDurationDays: 90, defaultDurationDays: 30, justificationRequired: true, allowForOthers: "access_managers" },
    });
    // Onboarding already made the application's policy; this updates it (200) to approve low-risk access automatically.
    expect([200, 201], await policy.text()).toContain(policy.status());
    const finance = (await entitlementIdByRef(tenantId, appId, "cn=finance"))!;

    const submitted = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: caraId, applicationId: appId, entitlementId: finance, justification: "ACCESS-P0-28 pending grant" } });
    expect(submitted.status(), await submitted.text()).toBe(201);
    const req = (await submitted.json()).data as { id: string; status: string };
    expect(req.status).toBe("approved");
    const view = async () => (await (await request.get(`/api/v1/access/requests/${req.id}`)).json()).data as { fulfilment: string; grants: { accountId: string; fulfilmentStatus: string }[] };

    // Approved: a pending grant on a placeholder account (Cara has no account yet); not access yet.
    const pending = await view();
    expect(pending.fulfilment).toBe("pending_fulfilment");
    expect(pending.grants).toHaveLength(1);
    const placeholder = pending.grants[0].accountId;
    const listed = (await (await request.get(`/api/v1/access/accounts?applicationId=${appId}&view=all`)).json()).data as { id: string; status: string; externalAccountRef: string }[];
    expect(listed.find((a) => a.id === placeholder)).toMatchObject({ status: "pending", externalAccountRef: `pending:${caraId}` });

    // ACCESS-P0-29: a fulfilment task waits for the application's owner (Ana); an access manager may work it too.
    const tasks = async () => (await (await request.get(`/api/v1/access/fulfilment-tasks?requestId=${req.id}`)).json()).data as { id: string; status: string; assigneeIdentityId: string | null; dueAt: string }[];
    const [task] = await tasks();
    expect(task).toMatchObject({ status: "open", assigneeIdentityId: anaId });
    expect(Date.parse(task.dueAt)).toBeGreaterThan(Date.now());
    const act = (action: string, note?: string) => request.post(`/api/v1/access/fulfilment-tasks/${task.id}`, { data: { action, note } });
    expect((await act("complete")).status()).toBe(200);
    expect((await tasks())[0].status).toBe("completed");
    // Done: someone says it was done, nobody has seen it yet.
    expect((await view()).fulfilment).toBe("fulfilled_unverified");
    expect((await act("fail")).status()).toBe(400);
    expect((await act("claim")).status()).toBe(409);

    // The account appears at the source: the placeholder hands its grant over and goes.
    await replaceIntegrationObjects(integrationId, tenantId, "account", [...ACCOUNTS, { externalId: "uid=cara", raw: { id: "cara", username: "cara", email: mail("cara") } }]);
    const accountsRun = await request.post(`/api/v1/access/applications/${appId}/reconciliations`);
    expect(accountsRun.status(), await accountsRun.text()).toBe(201);
    await loadAccounts(request);
    expect(accounts.cara).toMatchObject({ identityId: caraId, correlation: "correlated" });
    expect(accounts[`pending:${caraId}`]).toBeUndefined();
    const moved = await view();
    expect(moved.grants[0]).toMatchObject({ accountId: accounts.cara.id, fulfilmentStatus: "fulfilled_unverified" });
    expect((await ledgerFor(tenantId, accounts.cara.id)).find((e) => e.entitlementId === finance)?.status).toBe("PENDING_RECONCILIATION");

    // The grant appears at the source: verified, and approved in the ledger (never rogue).
    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", [...BASE_GRANTS, grant("uid=cara", "cn=finance")]);
    const counts = await reconcileAccess(request);
    expect(counts.grants).toMatchObject({ added: 0, verified: 1 });
    expect((await view()).fulfilment).toBe("verified");
    expect((await tasks())[0].status).toBe("verified");
    fulfilmentTaskId = task.id;
    await page.goto("/access/fulfilment?view=all");
    await expect(page.getByRole("heading", { name: "Fulfilment tasks" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Add Finance in E2E F1 App/ }).first()).toBeVisible();
    expect((await ledgerFor(tenantId, accounts.cara.id)).find((e) => e.entitlementId === finance)?.status).toBe("VALID");
    expect(await accessFindings(tenantId, accounts.cara.id)).toEqual([]);
  });

  test("ACCESS-P0-30: removing access, disabling an account and asking for one, each followed until the source confirms it", async ({ request }) => {
    test.setTimeout(150_000);
    const finance = (await entitlementIdByRef(tenantId, appId, "cn=finance"))!;
    type View = { status: string; fulfilment: string; tasks: { id: string; kind: string; status: string }[] };
    const submit = async (data: Record<string, unknown>) => {
      const res = await request.post("/api/v1/access/requests", { data: { justification: "ACCESS-P0-30 request", ...data } });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data as { id: string; status: string };
    };
    const view = async (id: string) => (await (await request.get(`/api/v1/access/requests/${id}`)).json()).data as View;
    const done = async (taskId: string) => expect((await request.post(`/api/v1/access/fulfilment-tasks/${taskId}`, { data: { action: "complete" } })).status()).toBe(200);
    const caraAccount = { externalId: "uid=cara", raw: { id: "cara", username: "cara", email: mail("cara") } };

    // Remove: approved, a removal task; done → removed, not yet verified; a second removal is refused while this one runs.
    const removal = await submit({ subjectIdentityId: caraId, applicationId: appId, entitlementId: finance, requestType: "remove" });
    expect(removal.status).toBe("approved");
    const r1 = await view(removal.id);
    expect(r1).toMatchObject({ fulfilment: "pending_fulfilment" });
    expect(r1.tasks.map((t) => t.kind)).toEqual(["remove"]);
    await done(r1.tasks[0].id);
    expect((await view(removal.id)).fulfilment).toBe("fulfilled_unverified");
    const again = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: caraId, applicationId: appId, entitlementId: finance, requestType: "remove", justification: "ACCESS-P0-30 twice" } });
    expect([200, 409]).toContain(again.status());
    // The source no longer lists it: revoked, and the removal is verified.
    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", BASE_GRANTS);
    const counts = await reconcileAccess(request);
    expect(counts.grants).toMatchObject({ revoked: 1 });
    expect((await grantsOf(tenantId, accounts.cara.id)).find((g) => g.entitlementId === finance)?.revokedAt).toBeTruthy();
    expect((await ledgerFor(tenantId, accounts.cara.id)).find((e) => e.entitlementId === finance)?.status).toBe("REVOKED");
    expect((await view(removal.id)).fulfilment).toBe("verified");

    // Disable the account: done, then the source shows it disabled.
    const disable = await submit({ subjectIdentityId: caraId, applicationId: appId, requestType: "disable_account" });
    const d1 = await view(disable.id);
    expect(d1.tasks.map((t) => t.kind)).toEqual(["disable_account"]);
    await done(d1.tasks[0].id);
    // A new account for Dan, who has none: a placeholder and a task to create it.
    const dan = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E F2 Dan ${stamp}`, email: mail("dan") } });
    const danId = (await dan.json()).data.id as string;
    const account = await submit({ subjectIdentityId: danId, applicationId: appId });
    const a1 = await view(account.id);
    expect(a1.tasks.map((t) => t.kind)).toEqual(["create_account"]);

    await replaceIntegrationObjects(integrationId, tenantId, "account", [
      ...ACCOUNTS,
      { ...caraAccount, raw: { ...caraAccount.raw, status: "disabled" } },
      { externalId: "uid=dan", raw: { id: "dan", username: "dan", email: mail("dan") } },
    ]);
    const run = await request.post(`/api/v1/access/applications/${appId}/reconciliations`);
    expect(run.status(), await run.text()).toBe(201);
    expect((await view(disable.id)).fulfilment).toBe("verified");
    expect((await view(account.id)).fulfilment).toBe("verified");
    await loadAccounts(request);
    expect(accounts.dan).toMatchObject({ identityId: danId });
    expect(accounts[`pending:${danId}`]).toBeUndefined();
  });

  test("ACCESS-P0-31: an owner requests for their service account and, within its contract, for their agent; anyone else is refused", async ({ request, browser }) => {
    test.setTimeout(150_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: me } = await db.from("identities").select("id, user_id").eq("tenant_id", tenantId).eq("identity_type", "HUMAN").eq("email", TEST_USERS.requester.email).limit(1).single();
    expect(me?.user_id).toBeTruthy();
    // Requests now wait for approval, and a manager (or an owner) may request for others.
    const policy = await request.post("/api/v1/access/request-policies", { data: { applicationId: appId, allowForOthers: "managers", autoApprove: false } });
    expect(policy.status(), await policy.text()).toBe(200);
    // A third entitlement; the agent's contract approves financial data only.
    await replaceIntegrationObjects(integrationId, tenantId, "entitlement", [...ENTITLEMENTS, { externalId: "cn=reports", raw: {}, normalized: { name: "Reports" } }]);
    await reconcileAccess(request);
    const ops = (await entitlementIdByRef(tenantId, appId, "cn=ops"))!;
    const reports = (await entitlementIdByRef(tenantId, appId, "cn=reports"))!;
    await db.from("entitlements").update({ data_classification: "financial" }).eq("tenant_id", tenantId).eq("id", reports);
    await db.from("entitlements").update({ data_classification: "customer" }).eq("tenant_id", tenantId).eq("id", ops);

    const svc = await request.post("/api/v1/identities", { data: { identityType: "SERVICE_ACCOUNT", displayName: `E2E F2 svc-report ${stamp}`, ownerIdentityId: me!.id } });
    expect(svc.status(), await svc.text()).toBe(201);
    const svcId = (await svc.json()).data.id as string;
    expect((await request.post(`/api/v1/agents/${agentId}/owners`, { data: { ownerType: "business_owner", userId: me!.user_id } })).status()).toBe(201);
    const contract = await request.post(`/api/v1/agents/${agentId}/contracts`, { data: { purpose: "Financial reporting", approvedApplications: [`E2E F1 App ${stamp}`], approvedData: ["financial"], approvedActions: ["READ"] } });
    expect(contract.status(), await contract.text()).toBe(201);
    // The agent goes live (a technical owner too; approval needs both owners).
    const { data: admin } = await db.from("identities").select("user_id").eq("tenant_id", tenantId).eq("identity_type", "HUMAN").eq("email", TEST_USERS.adminOne.email).limit(1).single();
    expect((await request.post(`/api/v1/agents/${agentId}/owners`, { data: { ownerType: "technical_owner", userId: admin!.user_id } })).status()).toBe(201);
    for (const toState of ["REGISTERED", "APPROVED", "PROVISIONED", "ACTIVE"]) {
      const moved = await request.post(`/api/v1/agents/${agentId}/lifecycle`, { data: { toState, reason: "ACCESS-P0-31" } });
      expect(moved.status(), `${toState}: ${await moved.text()}`).toBe(200);
    }
    const { data: agentIdentity } = await db.from("identities").select("id, status").eq("tenant_id", tenantId).eq("agent_id", agentId).single();
    expect(agentIdentity?.status).toBe("active");

    const owner = await browser.newContext({ storageState: authFile("requester") });
    const ask = (ctx: APIRequestContext, subjectIdentityId: string, entitlementId: string) =>
      ctx.post("/api/v1/access/requests", { data: { subjectIdentityId, applicationId: appId, entitlementId, justification: "ACCESS-P0-31 owner request" } });
    try {
      // The service account's owner may; someone who does not own it (svc-backup is Ana's) may not.
      const forSvc = await ask(owner.request, svcId, ops);
      expect(forSvc.status(), await forSvc.text()).toBe(201);
      const svcRequest = (await forSvc.json()).data as { id: string; status: string; policyResult: { checks: { check: string; result: string }[] } };
      expect(svcRequest.status).toBe("pending");
      expect(svcRequest.policyResult.checks).toContainEqual({ check: "for", result: "an identity you own" });
      const notOwned = await ask(owner.request, accounts["svc-backup"].identityId!, ops);
      expect(notOwned.status()).toBe(403);
      expect((await notOwned.json()).error.code).toBe("REQUEST_SCOPE");
      // Approval goes to the resource's owners (Ana, who cannot sign in, so access managers), never to the requester.
      const steps = (await (await request.get(`/api/v1/access/requests/${svcRequest.id}`)).json()).data.steps as { approverKind: string; reason: string | null }[];
      expect(steps[0]).toMatchObject({ approverKind: "access_managers" });
      expect(steps[0].reason).toMatch(/application owner/);

      // The agent: only its business owner, and only what its contract approves.
      const inContract = await ask(owner.request, agentIdentity!.id, reports);
      expect(inContract.status(), await inContract.text()).toBe(201);
      const agentRequest = (await inContract.json()).data as { id: string; agentId: string; subjectIdentityId: string };
      expect(agentRequest).toMatchObject({ agentId, subjectIdentityId: agentIdentity!.id });
      const outOfContract = await ask(owner.request, agentIdentity!.id, ops);
      expect(outOfContract.status()).toBe(403);
      expect((await outOfContract.json()).error.code).toBe("OUT_OF_CONTRACT");
      const notTheOwner = await ask(request, agentIdentity!.id, reports);
      expect(notTheOwner.status()).toBe(403);
      expect((await notTheOwner.json()).error.code).toBe("REQUEST_SCOPE");

      // Approved like anyone's: the pending grant lands on the agent's own account, with a fulfilment task.
      const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
      const decided = await iam.request.post(`/api/v1/access/requests/${agentRequest.id}/decision`, { data: { decision: "approved", comment: "Within the contract" } });
      expect(decided.status(), await decided.text()).toBe(200);
      await iam.close();
      const view = (await (await request.get(`/api/v1/access/requests/${agentRequest.id}`)).json()).data as { request: { status: string }; fulfilment: string; grants: { accountId: string }[]; tasks: { kind: string }[] };
      expect(view.request.status).toBe("approved");
      expect(view.fulfilment).toBe("pending_fulfilment");
      expect(view.grants.map((g) => g.accountId)).toEqual([accounts.finbot.id]);
      expect(view.tasks.map((t) => t.kind)).toEqual(["grant"]);

      // The request screen offers the owner what they own, and for the agent only what its contract approves.
      const page = await owner.newPage();
      await page.goto(`/access/catalog/${appId}`);
      const forSelect = page.getByRole("combobox", { name: "For", exact: true });
      await expect(forSelect.locator("option", { hasText: `E2E F2 svc-report ${stamp} (you own)` })).toHaveCount(1);
      await forSelect.selectOption(agentIdentity!.id);
      const offered = await page.getByRole("combobox", { name: "Access", exact: true }).locator("option").allTextContents();
      expect(offered).toContain("Reports");
      expect(offered).not.toContain("Ops");
    } finally {
      await owner.close();
    }
  });

  test("ACCESS-P0-32: an end date within the policy's cap, an approved extension, and at the end exactly one removal task; the ledger shows it expired", async ({ request }) => {
    test.setTimeout(180_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const policy = await request.post("/api/v1/access/request-policies", { data: { applicationId: appId, autoApprove: true, maxDurationDays: 30, defaultDurationDays: null } });
    expect(policy.status(), await policy.text()).toBe(200);
    const finance = (await entitlementIdByRef(tenantId, appId, "cn=finance"))!;
    const eve = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E F2 Eve ${stamp}`, email: mail("eve") } });
    const eveId = (await eve.json()).data.id as string;
    const ask = (data: Record<string, unknown>) => request.post("/api/v1/access/requests", { data: { subjectIdentityId: eveId, applicationId: appId, entitlementId: finance, justification: "ACCESS-P0-32 time-bound", ...data } });

    // Beyond the policy's cap: refused.
    const tooLong = await ask({ durationDays: 60 });
    expect(tooLong.status()).toBe(400);
    expect((await tooLong.json()).error.code).toBe("DURATION_TOO_LONG");
    const granted = await ask({ durationDays: 30 });
    expect(granted.status(), await granted.text()).toBe(201);
    const grantRequest = (await granted.json()).data as { id: string; status: string; requestedExpiry: string };
    expect(grantRequest.status).toBe("approved");

    // The access appears at the source and is verified.
    await replaceIntegrationObjects(integrationId, tenantId, "account", [
      ...ACCOUNTS,
      { externalId: "uid=cara", raw: { id: "cara", username: "cara", email: mail("cara"), status: "disabled" } },
      { externalId: "uid=dan", raw: { id: "dan", username: "dan", email: mail("dan") } },
      { externalId: "uid=eve", raw: { id: "eve", username: "eve", email: mail("eve") } },
    ]);
    expect((await request.post(`/api/v1/access/applications/${appId}/reconciliations`)).status()).toBe(201);
    await loadAccounts(request);
    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", [...BASE_GRANTS, grant("uid=eve", "cn=finance")]);
    expect((await reconcileAccess(request)).grants).toMatchObject({ verified: 1 });
    const view = async (id: string) => (await (await request.get(`/api/v1/access/requests/${id}`)).json()).data as { request: { status: string; requestedExpiry: string }; fulfilment: string; grants: { id: string }[] };
    const [eveGrant] = (await view(grantRequest.id)).grants;

    // Extending goes through the policy again (its cap included); approved, the access rests on the extension.
    const extendTooLong = await ask({ requestType: "extend", durationDays: 60 });
    expect(extendTooLong.status()).toBe(400);
    const extended = await ask({ requestType: "extend", durationDays: 14 });
    expect(extended.status(), await extended.text()).toBe(201);
    const extension = (await extended.json()).data as { id: string; status: string; requestType: string };
    expect(extension).toMatchObject({ status: "approved", requestType: "extend" });
    const ext = await view(extension.id);
    expect(ext.fulfilment).toBe("verified");
    expect(ext.grants.map((g) => g.id)).toEqual([eveGrant.id]);

    // The end date comes: one removal task, however often the sweep runs.
    const removalTasks = async () => (await db.from("access_fulfilment_tasks").select("id, status").eq("tenant_id", tenantId).eq("removal_grant_id", eveGrant.id)).data ?? [];
    await db.from("access_requests").update({ requested_expiry: new Date(Date.now() - 60_000).toISOString() }).eq("tenant_id", tenantId).eq("id", extension.id);
    expect((await request.get(`/access/requests/${extension.id}`)).status()).toBe(200); // the page sweeps its organization
    expect(await removalTasks()).toHaveLength(1);
    await db.from("access_requests").update({ expiry_processed_at: null }).eq("tenant_id", tenantId).eq("id", extension.id);
    expect((await request.get(`/access/requests/${extension.id}`)).status()).toBe(200);
    const tasks = await removalTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("open");
    expect((await grantsOf(tenantId, accounts.eve.id)).find((g) => g.entitlementId === finance)?.revokedAt).toBeNull();

    // Removed at the source: revoked by reconciliation, the task verified, and the ledger says it expired.
    await replaceIntegrationObjects(integrationId, tenantId, "access_grant", BASE_GRANTS);
    expect((await reconcileAccess(request)).grants).toMatchObject({ revoked: 1 });
    expect((await removalTasks())[0].status).toBe("verified");
    expect((await ledgerFor(tenantId, accounts.eve.id)).find((e) => e.entitlementId === finance)?.status).toBe("EXPIRED");
  });

  test("another organization sees none of it", async ({ browser }) => {
    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    const runs = await other.request.get(`/api/v1/access/applications/${appId}/access-reconciliations`);
    expect(runs.status() === 404 || ((await runs.json()).data ?? []).length === 0).toBe(true);
    const list = await other.request.get(`/api/v1/access/accounts?applicationId=${appId}&view=all`);
    expect(((await list.json()).data ?? []).length).toBe(0);
    const ident = await other.request.get(`/api/v1/identities/${accounts["svc-backup"].identityId}`);
    expect(ident.status()).toBe(404);
    const otherTasks = (await (await other.request.get("/api/v1/access/fulfilment-tasks?view=all")).json()).data as { id: string }[];
    expect(otherTasks.map((t) => t.id)).not.toContain(fulfilmentTaskId);
    expect((await other.request.post(`/api/v1/access/fulfilment-tasks/${fulfilmentTaskId}`, { data: { action: "claim" } })).status()).toBe(404);
    await other.close();
  });
});
