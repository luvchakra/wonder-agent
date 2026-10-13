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
 * - WID-H04: rogue access accepted as an exception (at most 90 days), then
 *   closed as a false positive, is not flagged again.
 * - Adding access (slice 2): an approved grant is added by the connector
 *   and verified. For a person with no account yet, the connector creates
 *   the account first; the next read brings it in and replaces the
 *   placeholder, then the access is added and verified.
 * - QA-P0-26 provisioning safety: a connection type without writes cannot
 *   be turned on; the mass-change guard refuses the change past the hourly
 *   limit (nothing sent, the owner's task with the reason) and "Try again"
 *   works once the limit allows; every change the system received is
 *   recorded once.
 * - WID-H02: the system sees one key per task and change, the same on
 *   every try. A change declared repeatable is tried three times; one that
 *   is not is sent once when its outcome is unclear. Then WonderID reads
 *   the system: the task closes by itself if the change is there, and
 *   "try again" waits for that read.
 * - INTEGRATION-P0-21: an incremental sync asks the system only for what
 *   changed since the last good run, stores it, and marks nothing missing.
 * - WID-C02 leaver: leaving opens a person's removal task for each access,
 *   and (owner decision 2026-10-12) the connector disables the account at
 *   once, verified by the next read. While the system is down the read fails and nothing
 *   closes. A removal marked done that the system still shows stays
 *   unconfirmed. Once it is really gone, the next read verifies it.
 * - Writes turned off: the next change is a person's task again.
 */

const stamp = Date.now();
const KEY = `e2e-writer-${stamp}`;
// WID-H02: the key the system sees, one per task and change.
const SYSTEM_KEY = /^fulfil:[0-9a-f-]{36}:[0-9a-f]{16}$/;
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
  // WID-H02: "before" answers 503 without the change; "after" makes it, then answers 503.
  failWrites: false as false | "before" | "after",
  // While set, reads of /users wait for it (to hold a verification read).
  holdReads: null as Promise<void> | null,
  // WID-C02: the whole system is unreachable (every request answers 503).
  down: false,
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
      disable_account: { repeatable: true, request: { method: "PATCH", path: "/users/{target.account}", body: { enabled: false } } },
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
    if (system.down) return send(503, { error: "down" });
    if (req.method === "GET" && url.pathname === "/api/ping") return send(200, { ok: true });
    if (req.method === "GET" && url.pathname === "/users") {
      if (system.holdReads) await system.holdReads;
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
      if (system.failWrites === "before") return send(503, { error: "maintenance" });
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
      if (system.failWrites === "after") return send(503, { error: "gateway timeout" });
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
    expect(system.writes).toEqual([{ method: "DELETE", path: "/groups/g-fin/members/u-ana", key: expect.stringMatching(SYSTEM_KEY) }]);
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

  test("a system error on a repeatable change: three tries with one key, then the owner's task with the reason; try again once it recovers, and it is verified", async ({ request, page }) => {
    test.setTimeout(150_000);
    system.failWrites = "before";
    const before = system.writes.length;
    const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.bob, applicationId: appId, requestType: "disable_account", justification: "INTEGRATION-P0-13 failure" } });
    expect(res.status(), await res.text()).toBe(201);
    const req = (await res.json()).data as { id: string; status: string };
    expect(req.status).toBe("approved");

    await expect.poll(async () => (await tasksOf(request, req.id))[0]?.connectorStatus, { timeout: 60_000 }).toBe("failed");
    const [failed] = await tasksOf(request, req.id);
    expect(failed).toMatchObject({ kind: "disable_account", status: "open", connectorError: expect.stringMatching(/HTTP 503/) });
    const attempts = system.writes.slice(before);
    // WID-H02: the same key on every try, so a system that honours it applies the change once.
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts.map((w) => w.key)).size).toBe(1);
    expect(attempts[0].key).toMatch(SYSTEM_KEY);
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

  test("WID-H02: a change that is not repeatable and may have been made is sent once; reading the system closes the task", async ({ request }) => {
    test.setTimeout(150_000);
    const ops = (await entitlementIdByRef(tenantId, appId, "g-ops"))!;
    const before = system.writes.length;
    system.failWrites = "after";
    try {
      const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.cy, applicationId: appId, entitlementId: ops, requestType: "grant", justification: "WID-H02 unclear outcome" } });
      expect(res.status(), await res.text()).toBe(201);
      const req = (await res.json()).data as { id: string; status: string };
      expect(req.status).toBe("approved");
      await expect.poll(async () => (await tasksOf(request, req.id))[0]?.connectorStatus, { timeout: 60_000 }).toMatch(/failed|succeeded/);
      // The system made the change but answered 503: never sent a second time.
      expect(system.members["g-ops"]).toContain("u-cy");
      expect(system.writes.slice(before)).toEqual([{ method: "PUT", path: "/groups/g-ops/members/u-cy", key: expect.stringMatching(SYSTEM_KEY) }]);
      // WonderID read the system, found the change, and closed the task.
      await expect.poll(async () => (await viewOf(request, req.id)).fulfilment, { timeout: 90_000 }).toBe("verified");
      expect(system.writes.length).toBe(before + 1);
    } finally {
      system.failWrites = false;
    }
  });

  test("WID-H02: when the change is not there, try again waits for the read of the system, then works", async ({ request }) => {
    test.setTimeout(150_000);
    const ops = (await entitlementIdByRef(tenantId, appId, "g-ops"))!;
    const before = system.writes.length;
    let release = () => {};
    system.failWrites = "before";
    system.holdReads = new Promise<void>((resolve) => (release = resolve));
    try {
      const res = await request.post("/api/v1/access/requests", { data: { subjectIdentityId: people.dee, applicationId: appId, entitlementId: ops, requestType: "grant", justification: "WID-H02 read before retry" } });
      expect(res.status(), await res.text()).toBe(201);
      const req = (await res.json()).data as { id: string };
      await expect.poll(async () => (await tasksOf(request, req.id))[0]?.connectorStatus, { timeout: 60_000 }).toBe("failed");
      const [held] = await tasksOf(request, req.id);
      expect(held.connectorError).toMatch(/may have made this change/);
      expect(system.writes.length).toBe(before + 1);

      // The read has not finished: trying again is refused, and nothing is sent.
      system.failWrites = false;
      const early = await request.post(`/api/v1/access/fulfilment-tasks/${held.id}`, { data: { action: "retry_connector" } });
      expect(early.status()).toBe(409);
      expect((await early.json()).error.code).toBe("READ_PENDING");
      expect(system.writes.length).toBe(before + 1);

      // Once the read has finished (the change is not there), trying again makes it.
      release();
      system.holdReads = null;
      await expect.poll(async () => (await request.post(`/api/v1/access/fulfilment-tasks/${held.id}`, { data: { action: "retry_connector" } })).status(), { timeout: 90_000, intervals: [3_000] }).toBe(200);
      expect(system.members["g-ops"]).toContain("u-dee");
      const sent = system.writes.slice(before);
      expect(sent).toHaveLength(2);
      expect(sent[1].key).toBe(sent[0].key);
      await expect.poll(async () => (await viewOf(request, req.id)).fulfilment, { timeout: 90_000 }).toBe("verified");
    } finally {
      release();
      system.holdReads = null;
      system.failWrites = false;
    }
  });

  test("F3 exit: rogue access is removed through the connector after a reviewer asks, verified, and its finding resolves", async ({ request, page }) => {
    test.setTimeout(180_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    // Someone adds Dee to Finance directly on the system: nothing in WonderID approved it.
    system.members["g-fin"].push("u-dee");
    await syncAndWait(request);
    const { data: dee } = await db.from("accounts").select("id").eq("tenant_id", tenantId).eq("application_id", appId).eq("external_account_ref", "u-dee").single();
    const findingOf = async () =>
      (await db.from("risk_findings").select("id, status, resolution_type, remediation_request_id, ticket:risk_access_tickets!risk_findings_access_ticket_fkey(ticket_number, status)").eq("tenant_id", tenantId).eq("category", "rogue_access").eq("account_id", dee!.id).order("created_at", { ascending: false }).limit(1)).data?.[0];
    await expect.poll(async () => (await findingOf())?.status, { timeout: 60_000 }).toBe("open");
    // The rogue account has one ticket people can quote, numbered per organization.
    type Ticket = { ticket_number: string; status: string };
    const ticketOf = async () => (await findingOf())?.ticket as unknown as Ticket | null;
    const ticket = (await ticketOf())!.ticket_number;
    expect(ticket).toMatch(/^RA-\d{6}$/);
    expect((await ticketOf())?.status).toBe("open");

    // A reviewer asks for it to be removed, from the account page.
    await page.goto(`/access/accounts/${dee!.id}`);
    const row = page.getByRole("listitem").filter({ hasText: "Finance" });
    await expect(page.getByText(`Ticket ${ticket} open`)).toBeVisible();
    await expect(row).toContainText("Finding open");
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
    // Dee's only rogue access is gone: the account's ticket resolved with it.
    expect(await ticketOf()).toEqual({ ticket_number: ticket, status: "resolved" });

    // A second ask is refused: the finding is closed.
    const again = await request.post(`/api/v1/findings/${raised!.id}/request-removal`);
    expect(again.status()).toBe(409);
  });

  test("WID-H04: rogue access accepted as an exception (90 days at most), then closed as a false positive, is not flagged again", async ({ request, page }) => {
    test.setTimeout(180_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    // Ana is put back in Finance directly on the system: rogue again.
    system.members["g-fin"].push("u-ana");
    await syncAndWait(request);
    const { data: ana } = await db.from("accounts").select("id").eq("tenant_id", tenantId).eq("application_id", appId).eq("external_account_ref", "u-ana").single();
    const findings = async () => (await db.from("risk_findings").select("id, status, exception_until, decision_reason, decided_by, resolution_type").eq("tenant_id", tenantId).eq("category", "rogue_access").eq("account_id", ana!.id).order("created_at", { ascending: false })).data ?? [];
    await expect.poll(async () => (await findings())[0]?.status, { timeout: 60_000 }).toBe("open");
    const [finding] = await findings();

    // Too long an exception is refused.
    const tooLong = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
    const refused = await request.post(`/api/v1/findings/${finding.id}/decision`, { data: { outcome: "exception", reason: "Audit season", until: tooLong } });
    expect(refused.status()).toBe(400);

    // Accepted as an exception from the account page, for 30 days.
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/access/accounts/${ana!.id}`);
    const row = page.getByRole("listitem").filter({ hasText: "Finance" });
    await row.getByText("Other outcomes").click();
    await row.getByLabel("Outcome").selectOption("exception");
    await row.getByLabel("Until (90 days at most)").fill(until);
    await row.getByLabel("Reason").fill("Covering month-end close");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText(`Exception until ${until}`, { timeout: 30_000 });
    expect((await findings())[0]).toMatchObject({ status: "exception", decision_reason: "Covering month-end close", decided_by: expect.any(String) });

    // A later read keeps the one finding: no duplicate while excepted.
    await syncAndWait(request);
    expect((await findings()).length).toBe(1);

    // Closed as a false positive: the same grant is not flagged again on the next read.
    const fp = await request.post(`/api/v1/findings/${finding.id}/decision`, { data: { outcome: "false_positive", reason: "Granted by the payroll process, approved outside WonderID" } });
    expect(fp.status(), await fp.text()).toBe(200);
    expect((await findings())[0]).toMatchObject({ status: "false_positive", resolution_type: "false_positive", exception_until: null });
    await syncAndWait(request);
    expect((await findings()).map((f) => f.status)).toEqual(["false_positive"]);

    const { data: audit } = await db.from("audit_logs").select("metadata").eq("tenant_id", tenantId).eq("object_id", finding.id).eq("action", "risk.access_finding_decided");
    expect((audit ?? []).map((a) => (a.metadata as { outcome: string }).outcome).sort()).toEqual(["exception", "false_positive"]);
  });

  test("RISK-P0-13: rogue access is given an owner, escalated, then approved afterwards until a date; it is approved from then on", async ({ request, page }) => {
    test.setTimeout(180_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const writesBefore = system.writes.length;
    // Bob is put in Operations directly on the system: rogue.
    system.members["g-ops"].push("u-bob");
    await syncAndWait(request);
    const ops = (await entitlementIdByRef(tenantId, appId, "g-ops"))!;
    const { data: bob } = await db.from("accounts").select("id").eq("tenant_id", tenantId).eq("application_id", appId).eq("external_account_ref", "u-bob").single();
    const findingOf = async () =>
      (await db.from("risk_findings").select("id, status, assigned_to, resolution_type, access_grant_id").eq("tenant_id", tenantId).eq("category", "rogue_access").eq("account_id", bob!.id).eq("entitlement_id", ops).order("created_at", { ascending: false }).limit(1)).data?.[0];
    await expect.poll(async () => (await findingOf())?.status, { timeout: 60_000 }).toBe("open");
    const finding = (await findingOf())!;

    // Its own page: owner, then escalate into an investigation.
    const { data: me } = await db.from("users").select("id").eq("email", "e2e-admin-1@e2e.wonderagent.test").single();
    await page.goto(`/risk/rogue-accounts/${finding.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Chosen once the page is interactive (a choice made before hydration is not seen).
    await expect(async () => {
      await page.getByLabel("Owner").selectOption(me!.id);
      await expect(page.getByRole("button", { name: "Assign" })).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Assigned." })).toBeVisible();
    expect(await findingOf()).toMatchObject({ status: "assigned", assigned_to: me!.id });
    await page.getByRole("button", { name: "Escalate" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Escalated to investigation INV-/ })).toBeVisible();
    expect((await findingOf())!.status).toBe("investigating");

    // Approving afterwards needs a reason; a date ten years out is refused.
    expect((await request.post(`/api/v1/findings/${finding.id}/authorize`, { data: { reason: " " } })).status()).toBe(400);
    expect((await request.post(`/api/v1/findings/${finding.id}/authorize`, { data: { reason: "x", until: "2040-01-01" } })).status()).toBe(400);

    // Approved afterwards from the page, for 30 days.
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await page.getByText("Other outcomes").click();
    await page.getByLabel("Outcome").selectOption("authorize");
    await page.getByLabel("Until (optional; removed then)").fill(until);
    await page.getByLabel("Reason").fill("Bob covers Operations during the migration");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Approved afterwards", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await findingOf()).toMatchObject({ status: "resolved", resolution_type: "approved_afterwards" });

    // Recorded as an approval: a fulfilled grant request with its end date, attached to the access.
    const { data: grant } = await db.from("access_grants").select("request_id").eq("tenant_id", tenantId).eq("id", finding.access_grant_id!).single();
    const { data: req } = await db.from("access_requests").select("status, request_type, requested_expiry, justification, decided_by").eq("tenant_id", tenantId).eq("id", grant!.request_id!).single();
    expect(req).toMatchObject({ status: "fulfilled", request_type: "grant", decided_by: me!.id });
    expect(req!.requested_expiry!.slice(0, 10)).toBe(until);
    expect(req!.justification).toContain("Approved afterwards");
    // Nothing was written to the system: the access already exists.
    expect(system.writes.slice(writesBefore)).toEqual([]);

    // The next read keeps it approved: no new rogue finding.
    await syncAndWait(request);
    const { data: open } = await db.from("risk_findings").select("id").eq("tenant_id", tenantId).eq("category", "rogue_access").eq("account_id", bob!.id).eq("entitlement_id", ops).in("status", ["open", "assigned", "investigating"]);
    expect(open).toEqual([]);
    // A second approval is refused: the finding is closed.
    expect((await request.post(`/api/v1/findings/${finding.id}/authorize`, { data: { reason: "again" } })).status()).toBe(409);
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
    expect(system.writes.slice(before)).toEqual([{ method: "PUT", path: "/groups/g-ops/members/u-ana", key: expect.stringMatching(SYSTEM_KEY) }]);
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
      try {
        await expect.poll(async () => (await viewOf(request, req.id)).fulfilment, { timeout: 60_000 }).toBe("verified");
      } catch (err) {
        // On the Vercel builder (13 October) the read that verifies this change never finished. Say what the
        // connection's syncs were doing, so the next failure names the cause.
        const { data: jobs } = await db
          .from("integration_sync_jobs")
          .select("trigger, mode, status, pipeline_status, created_at, started_at, ended_at, errors")
          .eq("tenant_id", tenantId)
          .eq("integration_id", integrationId)
          .order("created_at", { ascending: false })
          .limit(4);
        throw new Error(`${(err as Error).message}\nLatest syncs of the connection: ${JSON.stringify(jobs)}`);
      }
    } finally {
      await setLimit(original);
    }
  });

  test("QA-P0-26 / WID-H02 idempotency: a key always meant one change, retries reused it, and each request the system received is recorded once", async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const keys = system.writes.map((w) => w.key);
    expect(keys.every((k) => k !== null && SYSTEM_KEY.test(k))).toBe(true);
    const changes = new Map<string, Set<string>>();
    for (const w of system.writes) changes.set(w.key!, (changes.get(w.key!) ?? new Set()).add(`${w.method} ${w.path}`));
    expect([...changes.values()].every((c) => c.size === 1)).toBe(true);
    expect(changes.size).toBeLessThan(keys.length);
    const { data: rows } = await db.from("connector_write_operations").select("system_key, status").eq("tenant_id", tenantId).eq("integration_id", integrationId);
    const sent = (rows ?? []).filter((r) => r.status === "succeeded" || r.status === "failed");
    // One record per request the system saw, with the key it saw; blocked ones never reached it.
    expect(sent.map((r) => r.system_key).sort()).toEqual([...keys].sort());
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

  test("WID-C02 leaver: an outage closes nothing; a removal marked done but still in the system stays unconfirmed; verified once really gone", async ({ request }) => {
    test.setTimeout(240_000);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const ops = (await entitlementIdByRef(tenantId, appId, "g-ops"))!;
    const { data: account } = await db.from("accounts").select("id").eq("tenant_id", tenantId).eq("application_id", appId).eq("external_account_ref", "u-eve").single();
    const { data: grant } = await db.from("access_grants").select("id").eq("tenant_id", tenantId).eq("account_id", account!.id).eq("entitlement_id", ops).is("revoked_at", null).single();
    const grantState = async () => (await db.from("access_grants").select("removal_status, revoked_at").eq("id", grant!.id).single()).data!;
    const taskOf = async () => (await db.from("access_fulfilment_tasks").select("id, status, reason, connector_status").eq("tenant_id", tenantId).eq("kind", "remove").eq("removal_grant_id", grant!.id)).data ?? [];
    const syncEnds = async () => {
      const res = await request.post(`/api/v1/integrations/${integrationId}/sync`);
      expect(res.status(), await res.text()).toBe(202);
      const jobId = (await res.json()).data.id as string;
      await expect.poll(async () => ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string; pipelineStatus?: string }[]).find((j) => j.id === jobId)?.status, { timeout: 90_000 }).toMatch(/succeeded|partial|failed/);
      // Let the steps after the read (reconciliation) finish.
      await expect.poll(async () => ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; pipelineStatus?: string }[]).find((j) => j.id === jobId)?.pipelineStatus, { timeout: 90_000 }).not.toBe("running");
      return ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string }[]).find((j) => j.id === jobId)!.status;
    };

    // Eve leaves: a person's removal task for her access, due within a day;
    // the connector disables her account at once, and only that.
    const writesBefore = system.writes.length;
    const left = await request.post(`/api/v1/identities/${people.eve}/lifecycle`, { data: { toState: "DISABLED", note: "WID-C02 leaver" } });
    expect(left.status(), await left.text()).toBe(201);
    const [task] = await taskOf();
    expect(task).toMatchObject({ status: "open", reason: "leaver", connector_status: null });
    await expect.poll(() => system.users.find((u) => u.id === "u-eve")?.enabled, { timeout: 30_000 }).toBe(false);
    expect(system.writes.slice(writesBefore).map((w) => `${w.method} ${w.path}`)).toEqual(["PATCH /users/u-eve"]);
    const disableTask = async () => (await db.from("access_fulfilment_tasks").select("status, reason, connector_status").eq("tenant_id", tenantId).eq("kind", "disable_account").eq("account_id", account!.id)).data ?? [];
    await expect.poll(async () => (await disableTask())[0]?.connector_status, { timeout: 30_000 }).toBe("succeeded");
    expect((await disableTask())[0]).toMatchObject({ reason: "leaver" });

    // The system is down: the read fails, and nothing about the removal changes.
    system.down = true;
    try {
      expect(await syncEnds()).toBe("failed");
    } finally {
      system.down = false;
    }
    expect((await taskOf())[0]).toMatchObject({ status: "open" });
    expect(await grantState()).toMatchObject({ removal_status: "pending_removal", revoked_at: null });

    // Someone marks it done, but the system still has the access: it stays unconfirmed.
    const claimed = await request.post(`/api/v1/access/fulfilment-tasks/${task.id}`, { data: { action: "claim" } });
    expect(claimed.status(), await claimed.text()).toBe(200);
    const done = await request.post(`/api/v1/access/fulfilment-tasks/${task.id}`, { data: { action: "complete", note: "Removed (WID-C02)" } });
    expect(done.status(), await done.text()).toBe(200);
    expect(await syncEnds()).toBe("succeeded");
    expect((await taskOf())[0]).toMatchObject({ status: "completed" });
    expect(await grantState()).toMatchObject({ removal_status: "removed_unverified", revoked_at: null });

    // Really removed in the system: the next read verifies the removal.
    system.members["g-ops"] = system.members["g-ops"].filter((id) => id !== "u-eve");
    expect(await syncEnds()).toBe("succeeded");
    await expect.poll(async () => (await taskOf())[0]?.status, { timeout: 30_000 }).toBe("verified");
    expect((await grantState()).revoked_at).not.toBeNull();
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
