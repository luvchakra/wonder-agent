import { test, expect, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * WID-H03 — a read that fails partway through its pages, against a local
 * stub system that pages its accounts two at a time.
 * - A full read stages every account and marks nothing missing.
 * - When a middle page fails (and an account was really deleted meanwhile),
 *   the run does not succeed and marks nothing missing: neither the
 *   accounts on the failed page, nor the deleted one.
 * - Once the system recovers, a complete read marks only the deleted
 *   account missing.
 * - A page that silently comes back short (200, but fewer records than the
 *   system's X-Total-Count) is caught the same way: the run is partial and
 *   nothing is marked missing.
 */

const stamp = Date.now();
const KEY = `e2e-pages-${stamp}`;
const PAGE_SIZE = 2;
const system = {
  users: ["u-1", "u-2", "u-3", "u-4", "u-5"].map((id) => ({ id, login: `${id}-${stamp}` })),
  failPage: null as number | null,
  // A page that answers 200 with nothing, though the count says otherwise.
  emptyPage: null as number | null,
};
let stub: Server;
let baseUrl = "";
let integrationId = "";
let tenantId = "";

function definition() {
  return {
    schemaVersion: 1,
    key: KEY,
    version: "1.0.0",
    name: `E2E Pages ${stamp}`,
    category: "application",
    description: "A stub system that pages its accounts (WID-H03).",
    driver: "http",
    settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
    auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "Token" }] },
    test: { request: { path: "/ping" } },
    resources: {
      account: { request: { path: "/users" }, records: "", total: "header:X-Total-Count", pagination: { type: "page", param: "page", size: PAGE_SIZE }, fields: { externalId: "id", username: "login" } },
    },
  };
}

async function syncAndWait(request: APIRequestContext) {
  const res = await request.post(`/api/v1/integrations/${integrationId}/sync`);
  expect(res.status(), await res.text()).toBe(202);
  const jobId = (await res.json()).data.id as string;
  await expect
    .poll(async () => ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string }[]).find((j) => j.id === jobId)?.status, { timeout: 90_000 })
    .toMatch(/succeeded|partial|failed/);
  return ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string }[]).find((j) => j.id === jobId)!;
}

async function staged() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.from("integration_objects").select("external_id, missing_at_source_at").eq("tenant_id", tenantId).eq("integration_id", integrationId).eq("object_type", "account");
  expect(error).toBeNull();
  return Object.fromEntries((data ?? []).map((o) => [o.external_id as string, o.missing_at_source_at !== null]));
}

test.beforeAll(async () => {
  stub = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer e2e-token") {
      res.statusCode = 401;
      return res.end("{}");
    }
    if (url.pathname === "/ping") return res.end("{}");
    if (url.pathname === "/users") {
      const page = Number(url.searchParams.get("page") ?? "1");
      if (system.failPage === page) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ error: "maintenance" }));
      }
      res.setHeader("X-Total-Count", String(system.users.length));
      if (system.emptyPage === page) return res.end("[]");
      return res.end(JSON.stringify(system.users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => stub?.close(resolve));
});

test.describe.serial("a read that fails partway through its pages", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a full read stages every account and marks nothing missing", async ({ request }) => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    expect((await request.post("/api/v1/integrations/connectors", { data: definition() })).status()).toBe(201);
    const connected = await request.post("/api/v1/integrations/connectors/connect", { data: { origin: "custom", key: KEY, name: `E2E Pages ${stamp}`, settings: { baseUrl }, secret: { token: "e2e-token" } } });
    expect(connected.status(), await connected.text()).toBe(201);
    integrationId = (await connected.json()).data.integration.id;
    expect((await syncAndWait(request)).status).toBe("succeeded");
    expect(await staged()).toEqual({ "u-1": false, "u-2": false, "u-3": false, "u-4": false, "u-5": false });
  });

  test("a failed middle page: the run does not succeed and marks nothing missing", async ({ request }) => {
    test.setTimeout(150_000);
    // u-5 is really deleted, and the page holding u-3 and u-4 fails.
    system.users = system.users.filter((u) => u.id !== "u-5");
    system.failPage = 2;
    try {
      const job = await syncAndWait(request);
      expect(job.status).not.toBe("succeeded");
      expect(await staged()).toEqual({ "u-1": false, "u-2": false, "u-3": false, "u-4": false, "u-5": false });
    } finally {
      system.failPage = null;
    }
  });

  test("once the system recovers, a complete read marks only the deleted account missing", async ({ request }) => {
    test.setTimeout(150_000);
    expect((await syncAndWait(request)).status).toBe("succeeded");
    expect(await staged()).toEqual({ "u-1": false, "u-2": false, "u-3": false, "u-4": false, "u-5": true });
  });

  test("a page that silently comes back short is caught by the system's count: partial, nothing more marked missing", async ({ request }) => {
    test.setTimeout(150_000);
    system.emptyPage = 2;
    try {
      const job = await syncAndWait(request);
      expect(job.status).toBe("partial");
      expect(await staged()).toEqual({ "u-1": false, "u-2": false, "u-3": false, "u-4": false, "u-5": true });
    } finally {
      system.emptyPage = null;
    }
  });
});
