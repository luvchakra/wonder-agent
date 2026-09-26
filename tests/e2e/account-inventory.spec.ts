import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";
import { replaceIntegrationAccounts, seedIntegrationWithAccounts, type SeedAccount } from "./support/seedIntegrationAccounts";

/**
 * ACCESS-P0-17 — the account inventory against the real app and database.
 * An onboarded application's connector has imported accounts;
 * reconciliation (under the promoted configuration only) correlates them
 * to identities, flags orphans, ambiguity and privileged accounts, finds
 * dormant ones, keeps a person's manual link, and marks (never deletes)
 * accounts the source stopped listing. Other organizations and read-only
 * roles see and change nothing.
 */

const stamp = Date.now();
const mail = (who: string) => `e2e-acc-${who}-${stamp}@example.test`;
const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
const SOURCE: SeedAccount[] = [
  { externalId: "A1", raw: { id: "A1", username: "ana", email: mail("ana"), lastLogin: recent } },
  { externalId: "A2", raw: { id: "A2", username: "ghost", email: mail("ghost"), lastLogin: "2025-01-15T00:00:00Z" } },
  { externalId: "A3", raw: { id: "A3", username: "twin", email: mail("twin") } },
  { externalId: "A4", raw: { id: "A4", username: "root", email: mail("root"), privileged: true } },
  { externalId: "A5", raw: { username: "no-id", email: mail("ana") } },
];

let appId = "";
let integrationId = "";
let anaId = "";
let boId = "";

type Account = { id: string; externalAccountRef: string; identityId: string | null; correlation: string; accountType: string; dormant: boolean; missingFromSourceAt: string | null };

async function person(request: APIRequestContext, who: string, email = mail(who)) {
  const res = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Acc ${who} ${stamp}`, email } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id as string;
}

async function accounts(request: APIRequestContext, query: string) {
  const res = await request.get(`/api/v1/access/accounts?applicationId=${appId}&${query}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return { rows: body.data as Account[], summary: body.meta.summary as Record<string, number> };
}

const byRef = (rows: Account[], ref: string) => rows.find((r) => r.externalAccountRef === ref)!;

test.describe.serial("account inventory", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: people, a connector with imported accounts, and an onboarded application", async ({ request, browser }) => {
    // A whole onboarding (two simulations, a second approver) in one step.
    test.setTimeout(120_000);
    anaId = await person(request, "ana");
    boId = await person(request, "bo");
    await person(request, "twin-1", mail("twin"));
    await person(request, "twin-2", mail("twin"));
    integrationId = await seedIntegrationWithAccounts(TENANT_ONE.slug, `E2E Acc Connector ${stamp}`, SOURCE);

    const app = await request.post("/api/v1/access/applications", {
      data: { name: `E2E Acc App ${stamp}`, appType: "saas", businessOwnerIdentityId: anaId, technicalOwnerIdentityId: anaId, riskLevel: "medium", dataClassification: "internal" },
    });
    expect(app.status()).toBe(201);
    appId = (await app.json()).data.id;
    expect((await request.post(`/api/v1/access/applications/${appId}/entitlements`, { data: { name: "User", dataClassification: "internal", privilegeLevel: "standard" } })).status()).toBe(201);

    // Nothing to reconcile against before a configuration is live.
    expect((await request.post(`/api/v1/access/applications/${appId}/reconciliations`)).status()).toBe(409);

    const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${appId}/onboarding`, { data });
    expect((await onb({ action: "start" })).status()).toBe(200);
    const configured = await onb({
      action: "configure",
      config: {
        integrationId,
        accountIdentifierField: "id",
        correlationAccountField: "email",
        correlationIdentityField: "email",
        entitlementSource: "manual",
        requestPolicy: "owner_approval",
        certificationPolicy: "annual",
        provenanceEnabled: true,
      },
    });
    expect(configured.status(), await configured.text()).toBe(200);
    const validated = await (await onb({ action: "validate" })).json();
    expect(validated.data.validation.blockingFailures, JSON.stringify(validated.data.validation)).toEqual([]);
    // The simulation sees the account without an identifier and fails it.
    const sim = await (await onb({ action: "simulate" })).json();
    expect(sim.data.status).toBe("FAILED");
    expect(sim.data.simulation).toMatchObject({ accounts: 5, missingIdentifier: 1 });

    // The source fixes it; the next simulation passes and goes to approval.
    const tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    await replaceIntegrationAccounts(integrationId, tenantId, SOURCE.slice(0, 4));
    expect((await (await onb({ action: "simulate" })).json()).data.status).toBe("WAITING_FOR_APPROVAL");
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
    await iam.close();
    expect((await onb({ action: "promote" })).status()).toBe(200);
  });

  test("reconciliation correlates accounts to identities and flags orphans, ambiguity and privilege", async ({ request }) => {
    const res = await request.post(`/api/v1/access/applications/${appId}/reconciliations`);
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).data).toMatchObject({ status: "succeeded", sourceAccounts: 4, created: 4, updated: 0, correlated: 1, orphan: 2, ambiguous: 1, missingIdentifier: 0, notInSource: 0 });

    const { rows, summary } = await accounts(request, "view=all");
    expect(summary).toMatchObject({ total: 4, correlated: 1, orphan: 2, ambiguous: 1, privileged: 1, missing: 0 });
    expect(byRef(rows, "A1")).toMatchObject({ identityId: anaId, correlation: "correlated" });
    expect(byRef(rows, "A3")).toMatchObject({ identityId: null, correlation: "ambiguous" });
    expect(byRef(rows, "A4")).toMatchObject({ correlation: "orphan", accountType: "privileged" });

    const dormant = await accounts(request, "view=dormant&dormantDays=90");
    expect(dormant.rows.map((r) => r.externalAccountRef)).toEqual(["A2"]);
    expect((await accounts(request, "view=orphan")).rows.map((r) => r.externalAccountRef).sort()).toEqual(["A2", "A4"]);

    const runs = (await (await request.get(`/api/v1/access/applications/${appId}/reconciliations`)).json()).data;
    expect(runs[0]).toMatchObject({ status: "succeeded", created: 4 });
  });

  test("a manual link survives the next run; accounts the source dropped are marked, not deleted", async ({ request }) => {
    const a2 = byRef((await accounts(request, "view=all")).rows, "A2");
    expect((await request.patch(`/api/v1/access/accounts/${a2.id}`, { data: { identityId: "not-an-id" } })).status()).toBe(400);
    const linked = await request.patch(`/api/v1/access/accounts/${a2.id}`, { data: { identityId: boId } });
    expect(linked.status(), await linked.text()).toBe(200);
    expect((await linked.json()).data).toMatchObject({ identityId: boId, correlation: "manual" });

    // The source stops listing A4.
    const tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    await replaceIntegrationAccounts(integrationId, tenantId, SOURCE.slice(0, 3));
    const run = await request.post(`/api/v1/access/applications/${appId}/reconciliations`);
    expect((await run.json()).data).toMatchObject({ sourceAccounts: 3, created: 0, updated: 3, notInSource: 1 });

    const { rows, summary } = await accounts(request, "view=all");
    expect(summary.total).toBe(4);
    expect(byRef(rows, "A2")).toMatchObject({ identityId: boId, correlation: "manual" });
    expect(byRef(rows, "A4").missingFromSourceAt).toBeTruthy();
    expect((await accounts(request, "view=missing")).rows.map((r) => r.externalAccountRef)).toEqual(["A4"]);

    // Unlinking makes it an orphan again.
    const unlinked = await request.patch(`/api/v1/access/accounts/${a2.id}`, { data: { identityId: null } });
    expect((await unlinked.json()).data).toMatchObject({ identityId: null, correlation: "orphan" });
  });

  test("a person's account cannot be granted access yet, and an agent is never linked from here", async ({ request }) => {
    const a1 = byRef((await accounts(request, "view=all")).rows, "A1");
    const ent = (await (await request.get(`/api/v1/access/applications/${appId}/entitlements`)).json()).data[0];
    const grant = await request.post("/api/v1/access/grants", { data: { accountId: a1.id, entitlementId: ent.id } });
    expect(grant.status()).toBe(409);
    expect((await grant.json()).error.code).toBe("NOT_SUPPORTED");

    const agents = (await (await request.get("/api/v1/identities?type=AI_AGENT&pageSize=1")).json()).data as { id: string }[];
    test.skip(!agents.length, "no agent identity in this organization");
    expect((await request.patch(`/api/v1/access/accounts/${a1.id}`, { data: { identityId: agents[0].id } })).status()).toBe(400);
  });

  test("the inventory screens list, filter and link accounts", async ({ page }) => {
    await page.goto(`/access/accounts?app=${appId}`);
    await expect(page.getByRole("heading", { level: 1, name: `E2E Acc App ${stamp} accounts` })).toBeVisible();
    await expect(page.getByRole("row", { name: /A1/ })).toContainText(`E2E Acc ana ${stamp}`);
    await page.getByRole("navigation", { name: "Account views" }).getByRole("link", { name: /^Orphan/ }).click();
    await expect(page).toHaveURL(/view=orphan/);
    await expect(page.getByRole("row", { name: /ghost/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /ana/ })).toHaveCount(0);

    await page.getByRole("link", { name: "ghost" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "ghost" })).toBeVisible();
    await expect(page.getByText("Nothing matched")).toBeVisible();
    await page.getByRole("searchbox", { name: "Find an identity" }).fill(`E2E Acc bo ${stamp}`);
    await page.getByRole("button", { name: "Find" }).click();
    await page.getByRole("combobox", { name: "Belongs to" }).selectOption({ label: `E2E Acc bo ${stamp} (${mail("bo")}) · Person` });
    await page.getByRole("button", { name: "Link account" }).click();
    await expect(page.getByText(`Linked to E2E Acc bo ${stamp}.`)).toBeVisible();
    await expect(page.getByText("Linked by hand").first()).toBeVisible();
  });

  test("another organization sees none of it; read-only reads but cannot link or reconcile", async ({ browser, request }) => {
    const target = byRef((await accounts(request, "view=all")).rows, "A1");
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.get(`/api/v1/access/accounts/${target.id}`)).status()).toBe(404);
    expect((await two.request.patch(`/api/v1/access/accounts/${target.id}`, { data: { identityId: null } })).status()).toBe(404);
    expect((await two.request.post(`/api/v1/access/applications/${appId}/reconciliations`)).status()).toBe(404);
    expect((await (await two.request.get(`/api/v1/access/applications/${appId}/reconciliations`)).json()).data).toEqual([]);
    const theirs = (await (await two.request.get(`/api/v1/access/accounts?applicationId=${appId}`)).json()) as { data: Account[]; meta: { total: number } };
    expect(theirs.meta.total).toBe(0);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get(`/api/v1/access/accounts/${target.id}`)).status()).toBe(200);
    expect((await ro.request.patch(`/api/v1/access/accounts/${target.id}`, { data: { identityId: null } })).status()).toBe(403);
    expect((await ro.request.post(`/api/v1/access/applications/${appId}/reconciliations`)).status()).toBe(403);
    await ro.close();
  });
});
