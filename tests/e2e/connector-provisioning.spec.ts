import { test, expect, type APIRequestContext } from "@playwright/test";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";
import { entitlementIdByRef } from "./support/readAccessGovernance";

/**
 * INTEGRATION-P0-13 with INTEGRATION-P0-11 (decision D3): approved changes
 * carried out by a connector, against a local stub system the app reads
 * and writes over HTTP.
 * - A custom definition declares two writes; the connection writes nothing
 *   until an administrator turns writes on.
 * - An approved removal: the connector deletes the membership (with an
 *   idempotency key), the task completes, a verification sync reads the
 *   system again, and reconciliation verifies the removal.
 * - A system error: the connector tries three times, then hands the task
 *   back to its owner with the reason; nobody else acts while it runs;
 *   "try again" succeeds once the system recovers, and is verified.
 * - F3 exit test (RISK-P0-13): access added on the system with no approval
 *   is rogue with a finding; a reviewer asks to remove it; the request is
 *   approved under the application's policy, the connector removes it,
 *   reconciliation verifies it, and the finding resolves.
 * - Adding access (slice 2): an approved grant is added by the connector
 *   and verified. For a person with no account yet, the connector creates
 *   the account first; the next read brings it in and replaces the
 *   placeholder, then the access is added and verified.
 * - QA-P0-26 provisioning safety: a connection type without writes cannot
 *   be turned on; the mass-change guard refuses the change past the hourly
 *   limit (nothing sent, the owner's task with the reason) and "Try again"
 *   works once the limit allows; no attempt key ever reaches the system
 *   twice, and every change the system received is recorded once.
 * - INTEGRATION-P0-21: an incremental sync asks the system only for what
 *   changed since the last good run, stores it, and marks nothing missing.
 * - Writes turned off: the next change is a person's task again.
 */

const stamp = Date.now();
const KEY = `e2e-writer-${stamp}`;
const mail = (who: string) => `e2e-prov-${who}-${stamp}@example.test`;

type Call = { method: string; path: string; key: string | null };
const ALL_WRITES = ["revoke_access", "disable_account", "grant_access", "create_account"];
const system = {
  users: [
    { id: "u-ana", username: "ana", email: mail("ana"), enabled: true },
    { id: "u-bob", username: "bob", email: mail("bob"), enabled: true },
    { id: "u-cy", username: "cy", email: mail("cy"), enabled: true },
    { id: "u-dee", username: "dee", email: mail("dee"), enabled: true },
  ] as { id: string; username: string; email: string; enabled: boolean; changedAt?: string }[],
  members: { "g-fin": ["u-ana", "u-bob", "u-cy"], "g-ops": [] } as Record<string, string[]>,
  failWrites: false,
  reads: [] as string[],
  writes: [] as Call[],
};

let stub: Server;
let baseUrl = "";
let tenantId = "";
let integrationId = "";
let appId = "";
const people: Record<string, string> = {};

const body = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let s = "";
  req.on("data", (c) => (s += c));
  req.on("end", () => resolve(s));
});

function definition() {
  return {
    schemaVersion: 1,
    key: KEY,
    version: "1.0.0",
    name: `E2E Writer ${stamp}`,
    category: "application",
    description: "A stub system that WonderID reads and changes (INTEGRATION-P0-13).",
    driver: "http",
    settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
    auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "Token" }] },
    test: { request: { path: "/api/ping" } },
    // Staged records name the application they belong to: the one onboarded below.
    application: `E2E Prov App ${stamp}`,
    resources: {
      account: { request: { path: "/users" }, records: "", changes: { request: { path: "/users", query: { since: "{cursor.since}" } } }, fields: { externalId: "id", username: "username", email: "email", status: { path: "enabled", transform: [{ map: { true: "active", false: "disabled" } }] } } },
      entitlement: { request: { path: "/groups" }, records: "", fields: { externalId: "id", name: "name", type: { value: "group" } } },
      access_grant: { forEach: "entitlement", request: { path: "/groups/{parent.id}/members" }, records: "", fields: { externalId: { template: "{parent.id}:{record.id}" }, accountExternalId: "id", entitlementExternalId: "parent.id" } },
    },
    write: {
      revoke_access: { request: { method: "DELETE", path: "/groups/{target.entitlement}/members/{target.account}" } },
      disable_account: { request: { method: "PATCH", path: "/users/{target.account}", body: { enabled: false } } },
      grant_access: { request: { method: "PUT", path: "/groups/{target.entitlement}/members/{target.account}" } },
      create_account: { request: { method: "POST", path: "/users", body: { email: "{target.email}", name: "{target.displayName}" } } },
    },
  };
}

async function syncAndWait(request: APIRequestContext) {
  const res = await request.post(`/api/v1/integrations/${integrationId}/sync`);
  expect(res.status(), await res.text()).toBe(202);
  const jobId = (await res.json()).data.id as string;
  await expect.poll(async () => ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string; pipelineStatus?: string }[]).find((j) => j.id === jobId)?.status, { timeout: 60_000 }).toMatch(/succeeded|partial/);
}

const verificationJobs = async (request: APIRequestContext) =>
  ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { trigger: string; status: string }[]).filter((j) => j.trigger === "verification");

type Task = { id: string; kind: string; status: string; connectorStatus: string | null; connectorError: string | null };
const tasksOf = async (request: APIRequestContext, requestId: string) => (await (await request.get(`/api/v1/access/fulfilment-tasks?requestId=${requestId}`)).json()).data as Task[];
const viewOf = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/v1/access/requests/${id}`)).json()).data as { status: string; fulfilment: string };

test.beforeAll(async () => {
  stub = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    if (req.headers.authorization !== "Bearer e2e-token") return send(401, { error: "unauthorized" });
    if (req.method === "GET" && url.pathname === "/api/ping") return send(200, { ok: true });
    if (req.method === "GET" && url.pathname === "/users") {
      system.reads.push(url.search);
      const since = url.searchParams.get("since");
      return send(200, since ? system.users.filter((u) => u.changedAt && u.changedAt > since) : system.users);
    }
    if (req.method === "GET" && url.pathname === "/groups") return send(200, [{ id: "g-fin", name: "Finance" }, { id: "g-ops", name: "Operations" }]);
    const members = /^\/groups\/([^/]+)\/members$/.exec(url.pathname);
    if (req.method === "GET" && members) return send(200, (system.members[members[1]] ?? []).map((id) => ({ id })));
    const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
    const membership = /^\/groups\/([^/]+)\/members\/([^/]+)$/.exec(url.pathname);
    const user = /^\/users\/([^/]+)$/.exec(url.pathname);
    if ((req.method === "POST" && url.pathname === "/users") || ((req.method === "DELETE" || req.method === "PUT") && membership) || (req.method === "PATCH" && user)) {
      system.writes.push({ method: req.method, path: url.pathname, key });
      if (system.failWrites) return send(503, { error: "maintenance" });
      if (req.method === "POST") {
        const created = JSON.parse((await body(req)) || "{}") as { email?: string };
        const username = (created.email ?? "").split("@")[0].replace(/^e2e-prov-|-\d+$/g, "");
        const id = `u-${username}`;
        if (!system.users.some((u) => u.id === id)) system.users.push({ id, username, email: created.email ?? "", enabled: true, changedAt: new Date().toISOString() });
        return send(201, { id });
      }
      if (membership && req.method === "PUT" && !system.members[membership[1]]?.includes(membership[2])) system.members[membership[1]].push(membership[2]);
      if (membership && req.method === "DELETE") system.members[membership[1]] = (system.members[membership[1]] ?? []).filter((id) => id !== membership[2]);
      if (user) {
        const patch = JSON.parse((await body(req)) || "{}") as { enabled?: boolean };
        const u = system.users.find((x) => x.id === user[1]);
        if (u && patch.enabled === false) u.enabled = false;
      }
      return send(204);
    }
    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => stub?.close(resolve));
});

test.describe.serial("connector provisioning", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: a writing connection, synced, its application onboarded and reconciled; writes start off", async ({ request, browser }) => {
    test.setTimeout(180_000);
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    for (const who of ["ana", "bob", "cy", "dee", "eve"]) {
      const res = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", displayName: `E2E Prov ${who} ${stamp}`, email: mail(who) } });
      expect(res.status(), await res.text()).toBe(201);
      people[who] = (await res.json()).data.id;
    }
    const published = await request.post("/api/v1/integrations/connectors", { data: definition() });
    expect(published.status(), await published.text()).toBe(201);
    const connected = await request.post("/api/v1/integrations/connectors/connect", { data: { origin: "custom", key: KEY, name: `E2E Writer ${stamp}`, settings: { baseUrl }, secret: { token: "e2e-token" } } });
    expect(connected.status(), await connected.text()).toBe(201);
    integrationId = (await connected.json()).data.integration.id;

    // Supported, but off: a new connection writes nothing.
    const writes = await request.get(`/api/v1/integrations/${integrationId}/writes`);
    expect((await writes.json()).data).toEqual({ supported: ALL_WRITES, enabled: false });

    await syncAndWait(request);

    const app = await request.post("/api/v1/access/applications", {
      data: { name: `E2E Prov App ${stamp}`, appType: "saas", businessOwnerIdentityId: people.ana, technicalOwnerIdentityId: people.ana, riskLevel: "medium", dataClassification: "internal" },
    });
    expect(app.status(), await app.text()).toBe(201);
    appId = (await app.json()).data.id;
    const onb = (data: Record<string, unknown>, ctx: APIRequestContext = request) => ctx.post(`/api/v1/access/applications/${appId}/onboarding`, { data });
    expect((await onb({ action: "start" })).status()).toBe(200);
    const configured = await onb({
      action: "configure",
      config: { integrationId, accountIdentifierField: "id", correlationAccountField: "email", correlationIdentityField: "email", entitlementSource: "connector", requestPolicy: "owner_approval", certificationPolicy: "annual", provenanceEnabled: true },
    });
    expect(configured.status(), await configured.text()).toBe(200);
    expect((await (await onb({ action: "validate" })).json()).data.validation.blockingFailures).toEqual([]);
    expect((await (await onb({ action: "simulate" })).json()).data.status).toBe("WAITING_FOR_APPROVAL");
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    expect((await onb({ action: "approve" }, iam.request)).status()).toBe(200);
    await iam.close();
    expect((await onb({ action: "promote" })).status()).toBe(200);

    const accounts = await request.post(`/api/v1/access/applications/${appId}/reconciliations`);
    expect((await accounts.json()).data).toMatchObject({ status: "succeeded", sourceAccounts: 4, created: 4 });
    const preview = await request.post(`/api/v1/access/applications/${appId}/access-reconciliations`, { data: { dryRun: true } });
    const previewRun = (await preview.json()).data;
    const applied = await request.post(`/api/v1/access/applications/${appId}/access-reconciliations`, { data: { previewRunId: previewRun.id } });
    expect((await applied.json()).data.counts.grants).toMatchObject({ added: 3 });

    const policy = await request.post("/api/v1/access/request-policies", {
      data: { applicationId: appId, name: `E2E Prov Policy ${stamp}`, autoApprove: true, riskThreshold: "high", maxDurationDays: 90, defaultDurationDays: 30, justificationRequired: true, allowForOthers: "access_managers" },
    });
    expect([200, 201]).toContain(policy.status());
  });

  test("writes off: an approved removal is a person's task, and the connector touches nothing", async ({ request }) => {
    const finance = (await entitlementIdByRef(tenantId, appId, "g-fin"))!;
    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.cy, applicationId: appId, entitlementId: finance, requestType: "remove", justification: "INTEGRATION-P0-13 writes off" } });
    expect(res.status(), await res.text()).toBe(201);
    const req = (await res.json()).data as { id: string; status: string };
    expect(req.status).toBe("approved");
    const [task] = await tasksOf(request, req.id);
    expect(task).toMatchObject({ kind: "remove", status: "open", connectorStatus: null });
    expect(system.writes).toEqual([]);
  });

  test("writes on: an approved removal is made by the connector, then verified by reading the system again", async ({ request, page }) => {
    test.setTimeout(120_000);
    const on = await request.put(`/api/v1/integrations/${integrationId}/writes`, { data: { enabled: true } });
    expect((await on.json()).data).toEqual({ supported: ALL_WRITES, enabled: true });

    const finance = (await entitlementIdByRef(tenantId, appId, "g-fin"))!;
    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.ana, applicationId: appId, entitlementId: finance, requestType: "remove", justification: "INTEGRATION-P0-13 connector removal" } });
    expect(res.status(), await res.text()).toBe(201);
    const req = (await res.json()).data as { id: string; status: string };
    expect(req.status).toBe("approved");

    // The connector made the change once, with an idempotency key.
    await expect.poll(() => system.members["g-fin"].includes("u-ana"), { timeout: 30_000 }).toBe(false);
    expect(system.writes).toEqual([{ method: "DELETE", path: "/groups/g-fin/members/u-ana", key: expect.stringMatching(/^fulfil:[0-9a-f-]+:1$/) }]);
    // Then the system was read again and reconciliation verified it.
    await expect.poll(async () => (await viewOf(request, req.id)).fulfilment, { timeout: 60_000 }).toBe("verified");
    const [task] = await tasksOf(request, req.id);
    expect(task).toMatchObject({ status: "verified", connectorStatus: "succeeded" });
    expect((await verificationJobs(request)).length).toBeGreaterThanOrEqual(1);

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: audit } = await db.from("audit_logs").select("action, actor_type").eq("tenant_id", tenantId).eq("object_id", task.id).order("created_at");
    expect((audit ?? []).map((a) => a.action)).toEqual(expect.arrayContaining(["access.fulfilment_task_opened", "access.fulfilment_task_completed"]));

    await page.goto(`/integrations/${integrationId}`);
    await expect(page.getByRole("heading", { name: "Changes in the system" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn off" })).toBeVisible();
  });

  test("a system error: three tries, then the owner's task with the reason; try again once it recovers, and it is verified", async ({ request, page }) => {
    test.setTimeout(150_000);
    system.failWrites = true;
    const before = system.writes.length;
    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.bob, applicationId: appId, requestType: "disable_account", justification: "INTEGRATION-P0-13 failure" } });
    expect(res.status(), await res.text()).toBe(201);
    const req = (await res.json()).data as { id: string; status: string };
    expect(req.status).toBe("approved");

    await expect.poll(async () => (await tasksOf(request, req.id))[0]?.connectorStatus, { timeout: 60_000 }).toBe("failed");
    const [failed] = await tasksOf(request, req.id);
    expect(failed).toMatchObject({ kind: "disable_account", status: "open", connectorError: expect.stringMatching(/HTTP 503/) });
    const attempts = system.writes.slice(before);
    expect(attempts.map((w) => w.key)).toEqual([expect.stringMatching(/:1$/), expect.stringMatching(/:2$/), expect.stringMatching(/:3$/)]);
    expect(system.users.find((u) => u.id === "u-bob")?.enabled).toBe(true);

    await page.goto("/access/fulfilment");
    const row = page.getByRole("listitem").filter({ hasText: "Connector failed" }).filter({ hasText: "bob" });
    await expect(row).toContainText("HTTP 503");

    system.failWrites = false;
    await row.locator("summary", { hasText: "Connector" }).click();
    await row.getByRole("button", { name: /Try the connector again/ }).click();
    // Done: the task leaves the to-do list (completed, waiting for verification).
    await expect(row).toHaveCount(0, { timeout: 30_000 });
    expect(system.users.find((u) => u.id === "u-bob")?.enabled).toBe(false);
    await expect.poll(async () => (await tasksOf(request, req.id))[0]?.status, { timeout: 60_000 }).toBe("verified");
  });

  test("F3 exit: rogue access is removed through the connector after a reviewer asks, verified, and its finding resolves", async ({ request, page }) => {
    test.setTimeout(180_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    // Someone adds Dee to Finance directly on the system: nothing in WonderID approved it.
    system.members["g-fin"].push("u-dee");
    await syncAndWait(request);
    const { data: dee } = await db.from("accounts").select("id").eq("tenant_id", tenantId).eq("application_id", appId).eq("external_account_ref", "u-dee").single();
    const findingOf = async () =>
      (await db.from("risk_findings").select("id, status, resolution_type, remediation_request_id, ticket_number").eq("tenant_id", tenantId).eq("category", "rogue_access").eq("account_id", dee!.id).order("created_at", { ascending: false }).limit(1)).data?.[0];
    await expect.poll(async () => (await findingOf())?.status, { timeout: 60_000 }).toBe("open");
    // The finding is a ticket people can quote, numbered per organization.
    const ticket = (await findingOf())!.ticket_number as string;
    expect(ticket).toMatch(/^RA-\d{6}$/);

    // A reviewer asks for it to be removed, from the account page.
    await page.goto(`/access/accounts/${dee!.id}`);
    const row = page.getByRole("listitem").filter({ hasText: "Finance" });
    await expect(row).toContainText(`${ticket} open`);
    await row.getByRole("button", { name: "Remove access" }).click();
    await page.getByRole("button", { name: "Request it" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Done." })).toBeVisible({ timeout: 30_000 });
    const raised = await findingOf();
    expect(raised).toMatchObject({ status: "remediation_in_progress", remediation_request_id: expect.any(String) });

    // The connector removes it; the system is read again; the finding resolves as verified fixed.
    await expect.poll(() => system.members["g-fin"].includes("u-dee"), { timeout: 60_000 }).toBe(false);
    expect(system.writes.at(-1)).toMatchObject({ method: "DELETE", path: "/groups/g-fin/members/u-dee" });
    await expect.poll(async () => (await findingOf())?.status, { timeout: 90_000 }).toBe("resolved");
    expect((await findingOf())?.resolution_type).toBe("verified_fixed");
    expect((await viewOf(request, raised!.remediation_request_id as string)).fulfilment).toBe("verified");
    // The removal request quoted the ticket, and the ticket resolved with the finding.
    const { data: req } = await db.from("access_requests").select("justification").eq("tenant_id", tenantId).eq("id", raised!.remediation_request_id as string).single();
    expect(req!.justification).toContain(`Ticket ${ticket}`);
    expect((await findingOf())?.ticket_number).toBe(ticket);

    // A second ask is refused: the finding is closed.
    const again = await request.post(`/api/v1/findings/${raised!.id}/request-removal`);
    expect(again.status()).toBe(409);
  });

  test("slice 2: approved access is added by the connector and verified", async ({ request }) => {
    test.setTimeout(120_000);
    const ops = (await entitlementIdByRef(tenantId, appId, "g-ops"))!;
    const before = system.writes.length;
    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.ana, applicationId: appId, entitlementId: ops, requestType: "grant", justification: "INTEGRATION-P0-13 connector grant" } });
    expect(res.status(), await res.text()).toBe(201);
    const req = (await res.json()).data as { id: string; status: string };
    expect(req.status).toBe("approved");

    await expect.poll(() => system.members["g-ops"].includes("u-ana"), { timeout: 30_000 }).toBe(true);
    expect(system.writes.slice(before)).toEqual([{ method: "PUT", path: "/groups/g-ops/members/u-ana", key: expect.stringMatching(/^fulfil:[0-9a-f-]+:1$/) }]);
    await expect.poll(async () => (await viewOf(request, req.id)).fulfilment, { timeout: 60_000 }).toBe("verified");
    const [task] = await tasksOf(request, req.id);
    expect(task).toMatchObject({ kind: "grant", status: "verified", connectorStatus: "succeeded" });
  });

  test("slice 2: no account yet: the connector creates it, the next read brings it in, then the access is added and verified", async ({ request }) => {
    test.setTimeout(180_000);
    const ops = (await entitlementIdByRef(tenantId, appId, "g-ops"))!;
    const before = system.writes.length;
    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.eve, applicationId: appId, entitlementId: ops, requestType: "grant", justification: "INTEGRATION-P0-13 create then grant" } });
    expect(res.status(), await res.text()).toBe(201);
    const req = (await res.json()).data as { id: string; status: string };
    expect(req.status).toBe("approved");

    // Account first, named after Eve; then, once it is read back, the access.
    await expect.poll(() => system.members["g-ops"].includes("u-eve"), { timeout: 90_000 }).toBe(true);
    expect(system.writes.slice(before).map((w) => `${w.method} ${w.path}`)).toEqual(["POST /users", "PUT /groups/g-ops/members/u-eve"]);
    expect(system.users.find((u) => u.id === "u-eve")?.email).toBe(mail("eve"));
    await expect.poll(async () => (await viewOf(request, req.id)).fulfilment, { timeout: 90_000 }).toBe("verified");
    const tasks = await tasksOf(request, req.id);
    expect(tasks.map((t) => [t.kind, t.status, t.connectorStatus]).sort()).toEqual([
      ["create_account", "verified", "succeeded"],
      ["grant", "verified", "succeeded"],
    ]);
    // The placeholder is gone: Eve has one account, the real one.
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: accounts } = await db.from("accounts").select("external_account_ref, status").eq("tenant_id", tenantId).eq("application_id", appId).eq("identity_id", people.eve);
    expect(accounts).toEqual([{ external_account_ref: "u-eve", status: "active" }]);
  });

  test("QA-P0-26 read-only: a connection type that declares no writes cannot be turned on", async ({ request }) => {
    const readOnlyKey = `${KEY}-ro`;
    const { write: _write, ...readOnly } = definition();
    void _write;
    const published = await request.post("/api/v1/integrations/connectors", { data: { ...readOnly, key: readOnlyKey, name: `E2E Read-only ${stamp}` } });
    expect(published.status(), await published.text()).toBe(201);
    const connected = await request.post("/api/v1/integrations/connectors/connect", { data: { origin: "custom", key: readOnlyKey, name: `E2E Read-only ${stamp}`, settings: { baseUrl }, secret: { token: "e2e-token" } } });
    expect(connected.status(), await connected.text()).toBe(201);
    const id = (await connected.json()).data.integration.id as string;
    expect((await (await request.get(`/api/v1/integrations/${id}/writes`)).json()).data).toEqual({ supported: [], enabled: false });
    const on = await request.put(`/api/v1/integrations/${id}/writes`, { data: { enabled: true } });
    expect(on.status()).toBe(409);
    expect((await (await request.get(`/api/v1/integrations/${id}/writes`)).json()).data.enabled).toBe(false);
  });

  test("QA-P0-26 mass-change guard: past the hourly limit nothing is sent and the owner gets the task; it runs once the limit allows", async ({ request }) => {
    test.setTimeout(120_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await db.from("connector_write_operations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("integration_id", integrationId).in("status", ["requested", "succeeded"]).gte("created_at", since);
    const original = ((await (await request.get("/api/v1/tenant/configuration")).json()).data as Record<string, number>)["integration.maxWritesPerHour"];
    const setLimit = async (n: number) => {
      const res = await request.patch("/api/v1/tenant/configuration", { data: { "integration.maxWritesPerHour": n } });
      expect([200, 409], await res.text()).toContain(res.status()); // 409: unchanged
    };
    try {
      // This connection has made `count` changes this hour: make that the limit.
      await setLimit(count!);
      const ops = (await entitlementIdByRef(tenantId, appId, "g-ops"))!;
      const before = system.writes.length;
      const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.ana, applicationId: appId, entitlementId: ops, requestType: "remove", justification: "QA-P0-26 mass-change guard" } });
      expect(res.status(), await res.text()).toBe(201);
      const req = (await res.json()).data as { id: string; status: string };
      expect(req.status).toBe("approved");
      await expect.poll(async () => (await tasksOf(request, req.id))[0]?.connectorStatus, { timeout: 30_000 }).toBe("failed");
      const [held] = await tasksOf(request, req.id);
      expect(held).toMatchObject({ kind: "remove", status: "open", connectorError: expect.stringMatching(/Mass-change guard: .*\(limit \d+\)/) });
      expect(system.writes.length).toBe(before);
      expect(system.members["g-ops"]).toContain("u-ana");

      // Still at the limit, trying again is refused the same way; nothing is sent.
      const again = await request.post(`/api/v1/access/fulfilment-tasks/${held.id}`, { data: { action: "retry_connector" } });
      expect((await again.json()).data).toMatchObject({ connectorStatus: "failed", connectorError: expect.stringMatching(/Mass-change guard/) });
      expect(system.writes.length).toBe(before);

      // Room again: the owner's "Try again" makes the change, verified as usual.
      await setLimit(count! + 10);
      const retried = await request.post(`/api/v1/access/fulfilment-tasks/${held.id}`, { data: { action: "retry_connector" } });
      expect(retried.status(), await retried.text()).toBe(200);
      expect(system.members["g-ops"]).not.toContain("u-ana");
      await expect.poll(async () => (await viewOf(request, req.id)).fulfilment, { timeout: 60_000 }).toBe("verified");
    } finally {
      await setLimit(original);
    }
  });

  test("QA-P0-26 idempotency: no attempt key reached the system twice, and each change it received is recorded once", async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const keys = system.writes.map((w) => w.key);
    expect(keys.every((k) => k !== null)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    const { data: rows } = await db.from("connector_write_operations").select("idempotency_key, status").eq("tenant_id", tenantId).eq("integration_id", integrationId);
    const sent = (rows ?? []).filter((r) => r.status === "succeeded" || r.status === "failed");
    // Every request the system saw has its one record; blocked ones never reached it.
    expect(sent.map((r) => r.idempotency_key).sort()).toEqual([...keys].sort());
    expect((rows ?? []).filter((r) => r.status === "blocked").every((r) => !keys.includes(r.idempotency_key))).toBe(true);
  });

  test("INTEGRATION-P0-21: an incremental sync reads only what changed and marks nothing missing", async ({ request }) => {
    test.setTimeout(120_000);
    // A user appears on the system; another disappears (an incremental run must not call that missing).
    system.users.push({ id: "u-gus", username: "gus", email: mail("gus"), enabled: true, changedAt: new Date().toISOString() });
    const cy = system.users.splice(system.users.findIndex((u) => u.id === "u-cy"), 1)[0];
    const readsBefore = system.reads.length;
    try {
      const res = await request.post(`/api/v1/integrations/${integrationId}/sync`, { data: { mode: "incremental" } });
      expect(res.status(), await res.text()).toBe(202);
      const jobId = (await res.json()).data.id as string;
      type Job = { id: string; status: string; mode: string; missingSummary: Record<string, { status: string; reason?: string }> };
      const jobOf = async () => ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as Job[]).find((j) => j.id === jobId);
      await expect.poll(async () => (await jobOf())?.status, { timeout: 60_000 }).toMatch(/succeeded|partial/);
      const job = (await jobOf())!;
      expect(job.mode).toBe("incremental");
      expect(job.missingSummary.account).toEqual({ status: "skipped", reason: "incremental run" });
      // Users were read with a cursor, and only once.
      const reads = system.reads.slice(readsBefore);
      expect(reads).toHaveLength(1);
      expect(reads[0]).toMatch(/^\?since=\d{4}-\d{2}-\d{2}T/);

      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { data: staged } = await db.from("integration_objects").select("external_id, missing_at_source_at").eq("tenant_id", tenantId).eq("integration_id", integrationId).eq("object_type", "account").in("external_id", ["u-gus", "u-cy"]);
      expect(Object.fromEntries((staged ?? []).map((o) => [o.external_id, o.missing_at_source_at]))).toEqual({ "u-gus": null, "u-cy": null });
    } finally {
      system.users.push(cy);
    }
  });

  test("writes off again: the next change is a person's task", async ({ request }) => {
    const off = await request.put(`/api/v1/integrations/${integrationId}/writes`, { data: { enabled: false } });
    expect((await off.json()).data.enabled).toBe(false);
    const before = system.writes.length;
    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.cy, applicationId: appId, requestType: "disable_account", justification: "INTEGRATION-P0-13 off again" } });
    expect(res.status(), await res.text()).toBe(201);
    const req = (await res.json()).data as { id: string };
    const [task] = await tasksOf(request, req.id);
    expect(task).toMatchObject({ status: "open", connectorStatus: null });
    expect(system.writes.length).toBe(before);
  });
});
