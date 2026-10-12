import { test, expect, type APIRequestContext } from "@playwright/test";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * INTEGRATION-P0-21 — "Sign in with the provider" (OAuth 2.0 authorization
 * code with PKCE), against a local stub provider that is also the system.
 * - A connection is saved with only its client ID and secret: nothing to
 *   test yet, so it saves, and its page says "Not connected".
 * - Connect: the browser goes to the provider's own sign-in page with a
 *   PKCE challenge and comes back through the connection's receiver; the
 *   code is traded for tokens with the matching verifier and the client
 *   secret, and the page says it is connected.
 * - Syncs sign in with the stored refresh token; a rotated refresh token
 *   is stored, so the next sync uses the new one.
 * - A callback whose state was tampered with, or that arrives without the
 *   browser's cookie, changes nothing.
 * - Every step is audited, and no token is in any audit row.
 */

const stamp = Date.now();
const KEY = `e2e-oauth-${stamp}`;

const provider = {
  authorizeRequests: [] as URLSearchParams[],
  tokenRequests: [] as URLSearchParams[],
  apiTokens: [] as string[],
  refreshCount: 0,
};

let stub: Server;
let baseUrl = "";
let tenantId = "";
let integrationId = "";

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
  });

function definition() {
  return {
    schemaVersion: 1,
    key: KEY,
    version: "1.0.0",
    name: `E2E OAuth ${stamp}`,
    category: "application",
    description: "A stub system that signs in with the provider (INTEGRATION-P0-21).",
    driver: "http",
    settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
    auth: {
      type: "oauth2_authorization_code",
      authorizeUrl: "/authorize",
      tokenUrl: "/token",
      clientId: "{secret.clientId}",
      clientSecret: "{secret.clientSecret}",
      scope: "users.read offline_access",
      authorizeParams: { prompt: "consent" },
      fields: [
        { key: "clientId", label: "Client ID" },
        { key: "clientSecret", label: "Client secret" },
      ],
    },
    test: { request: { path: "/api/ping" } },
    resources: { account: { request: { path: "/users" }, records: "", fields: { externalId: "id", username: "username" } } },
  };
}

async function syncAndWait(request: APIRequestContext) {
  const res = await request.post(`/api/v1/integrations/${integrationId}/sync`);
  expect(res.status(), await res.text()).toBe(202);
  const jobId = (await res.json()).data.id as string;
  await expect
    .poll(async () => ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string }[]).find((j) => j.id === jobId)?.status, { timeout: 60_000 })
    .toMatch(/succeeded|partial|failed/);
  return ((await (await request.get(`/api/v1/integrations/${integrationId}/jobs`)).json()).data as { id: string; status: string; errors?: unknown }[]).find((j) => j.id === jobId)!;
}

test.beforeAll(async () => {
  stub = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const send = (status: number, data?: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    if (req.method === "GET" && url.pathname === "/authorize") {
      // The provider's own sign-in page: the administrator approves at once.
      provider.authorizeRequests.push(url.searchParams);
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", `code-${provider.authorizeRequests.length}`);
      back.searchParams.set("state", url.searchParams.get("state")!);
      res.statusCode = 302;
      res.setHeader("location", back.toString());
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/token") {
      const form = new URLSearchParams(await body(req));
      provider.tokenRequests.push(form);
      if (form.get("client_id") !== "client-e2e" || form.get("client_secret") !== "secret-e2e") return send(401, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code") {
        const authorize = provider.authorizeRequests.at(-1)!;
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (challenge !== authorize.get("code_challenge") || form.get("redirect_uri") !== authorize.get("redirect_uri")) return send(400, { error: "invalid_grant" });
        // A short-lived access token, so every sync refreshes.
        return send(200, { access_token: "at-0", refresh_token: "rt-0", expires_in: 1 });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (form.get("refresh_token") !== `rt-${provider.refreshCount}`) return send(400, { error: "invalid_grant" });
        provider.refreshCount += 1;
        return send(200, { access_token: `at-${provider.refreshCount}`, refresh_token: `rt-${provider.refreshCount}`, expires_in: 1 });
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer at-")) return send(401, { error: "unauthorized" });
    provider.apiTokens.push(auth.slice(7));
    if (url.pathname === "/api/ping") return send(200, { ok: true });
    if (url.pathname === "/users") return send(200, [{ id: "u-1", username: "ana" }]);
    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => stub?.close(resolve));
});

test.describe.serial("sign in with the provider", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a connection saved with its client ID and secret is not connected yet", async ({ request, page }) => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const published = await request.post("/api/v1/integrations/connectors", { data: definition() });
    expect(published.status(), await published.text()).toBe(201);
    const connected = await request.post("/api/v1/integrations/connectors/connect", {
      data: { origin: "custom", key: KEY, name: `E2E OAuth ${stamp}`, settings: { baseUrl }, secret: { clientId: "client-e2e", clientSecret: "secret-e2e" } },
    });
    expect(connected.status(), await connected.text()).toBe(201);
    const data = (await connected.json()).data;
    expect(data.credentialError).toBeNull();
    integrationId = data.integration.id;

    // A sync before connecting fails with what to do.
    const job = await syncAndWait(request);
    expect(job.status).toBe("failed");
    expect(JSON.stringify(job.errors)).toMatch(/Not connected yet/);

    await page.goto(`/integrations/${integrationId}`);
    await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
    await page.getByText("Address to register with the provider").click();
    await expect(page.getByText(`/api/connect/v1/${integrationId}/oauth/callback`)).toBeVisible();
  });

  test("Connect: the provider's sign-in with PKCE, back through the receiver, connected", async ({ page }) => {
    await page.goto(`/integrations/${integrationId}`);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.waitForURL(/oauth=/, { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("oauth")).toBe("connected");
    await expect(page.getByText(/^Connected\. WonderID now signs in/)).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();

    const sent = provider.authorizeRequests.at(-1)!;
    expect(sent.get("response_type")).toBe("code");
    expect(sent.get("client_id")).toBe("client-e2e");
    expect(sent.get("code_challenge_method")).toBe("S256");
    expect(sent.get("prompt")).toBe("consent");
    expect(sent.get("redirect_uri")).toMatch(new RegExp(`/api/connect/v1/${integrationId}/oauth/callback$`));
    expect([...sent.values()].join(" ")).not.toMatch(/secret-e2e/);
    const exchange = provider.tokenRequests.find((f) => f.get("grant_type") === "authorization_code")!;
    expect(exchange.get("code")).toBe("code-1");
    // The connection test after connecting used the new sign-in.
    expect(provider.apiTokens.length).toBeGreaterThan(0);
  });

  test("syncs sign in with the stored refresh token, and keep a rotated one", async ({ request }) => {
    test.setTimeout(120_000);
    const first = await syncAndWait(request);
    expect(first.status).toBe("succeeded");
    const second = await syncAndWait(request);
    expect(second.status).toBe("succeeded");
    // Each run refreshed with the refresh token the previous one stored.
    const refreshes = provider.tokenRequests.filter((f) => f.get("grant_type") === "refresh_token").map((f) => f.get("refresh_token"));
    expect(refreshes.slice(-2)).toEqual([`rt-${provider.refreshCount - 2}`, `rt-${provider.refreshCount - 1}`]);
    expect(provider.apiTokens.at(-1)).toBe(`at-${provider.refreshCount}`);
  });

  test("a tampered state, or a callback without the browser's cookie, changes nothing", async ({ request }) => {
    const before = provider.tokenRequests.length;
    const forged = await request.get(`/api/connect/v1/${integrationId}/oauth/callback?code=stolen&state=abc.def`, { maxRedirects: 0 });
    expect(forged.status()).toBe(303);
    expect(forged.headers().location).toMatch(new RegExp(`/integrations/${integrationId}\\?oauth=expired$`));
    const other = await request.get(`/api/connect/v1/${integrationId}/oauth/callback?error=access_denied`, { maxRedirects: 0 });
    expect(other.headers().location).toMatch(/oauth=expired$/);
    expect(provider.tokenRequests.length).toBe(before);
  });

  test("every step is audited, and no audit row holds a token", async () => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data } = await db.from("audit_logs").select("action, outcome, actor_type, metadata").eq("tenant_id", tenantId).eq("object_id", integrationId).order("created_at");
    const actions = (data ?? []).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["integration.oauth_started", "integration.oauth_connected", "integration.oauth_refresh_rotated"]));
    expect((data ?? []).find((a) => a.action === "integration.oauth_connected")).toMatchObject({ outcome: "success", actor_type: "user" });
    expect(JSON.stringify(data)).not.toMatch(/rt-\d|at-\d|secret-e2e|code-1/);
  });
});
