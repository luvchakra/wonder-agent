import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, TENANT_ONE } from "./support/testUsers";
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
    const caraId = (await cara.json()).data.id as string;
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
    await expect(page.getByRole("link", { name: /^Finance in E2E F1 App/ }).first()).toBeVisible();
    expect((await ledgerFor(tenantId, accounts.cara.id)).find((e) => e.entitlementId === finance)?.status).toBe("VALID");
    expect(await accessFindings(tenantId, accounts.cara.id)).toEqual([]);
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
