// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let getUserResult: { data: { user: null }; error: unknown } = { data: { user: null }, error: null };
// FOUNDATION-P0-22 — which labels name an organization, and how often the lookup is asked.
let knownLabels = new Set<string>();
let lookupFails = false;
const rpc = vi.fn(async (_fn: string, args: { p_subdomain: string | null }) =>
  lookupFails ? { data: null, error: { message: "db down" } } : { data: knownLabels.has(args.p_subdomain ?? "") ? [{ tenant_id: "t1", name: "Acme", slug: args.p_subdomain, status: "active" }] : [], error: null },
);
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => getUserResult, signOut: vi.fn() }, rpc }) }));
vi.mock("@/lib/db/env", () => ({ getOptionalSupabaseUrl: () => "https://example.supabase.co", getOptionalSupabasePublishableKey: () => "pk" }));
vi.mock("@/lib/tenant/getTenantContext", () => ({ TENANT_COOKIE_NAME: "wa_tenant" }));

import { proxy } from "./proxy";

const withSession = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { cookie: "sb-abc-auth-token=x" } });

beforeEach(() => {
  getUserResult = { data: { user: null }, error: null };
  knownLabels = new Set();
  lookupFails = false;
  rpc.mockClear();
  delete process.env.BASE_APP_HOST;
});

describe("proxy when the auth server cannot be reached (fail closed, truthfully)", () => {
  beforeEach(() => {
    getUserResult = { data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } };
  });

  it("an API call gets 503 AUTH_UNAVAILABLE, not 401", async () => {
    const res = await proxy(withSession("/api/v1/access/accounts"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()).error.code).toBe("AUTH_UNAVAILABLE");
  });

  it("a page is answered by the service-unavailable page with 503, and never by the app", async () => {
    const res = await proxy(withSession("/access"));
    expect(res.status).toBe(503);
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/service-unavailable$/);
    expect(res.headers.get("location")).toBeNull();
  });

  it("a public page still passes through", async () => {
    const res = await proxy(withSession("/help"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("proxy when the auth server rejects the session (unchanged)", () => {
  it("a page redirects to sign-in with the expired reason; an API call gets 401", async () => {
    getUserResult = { data: { user: null }, error: { name: "AuthApiError", status: 403, message: "Session not found" } };
    const page = await proxy(withSession("/access"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toMatch(/\/sign-in\?reason=expired$/);
    const api = await proxy(withSession("/api/v1/access/accounts"));
    expect(api.status).toBe(401);
  });
});

describe("proxy on tenant addresses (FOUNDATION-P0-22)", () => {
  const at = (host: string, path: string) => new NextRequest(`http://${host}${path}`, { headers: { host } });
  beforeEach(() => {
    process.env.BASE_APP_HOST = "wonderid.example";
  });

  it("an address that names no organization is a 404 on pages and on the API", async () => {
    const page = await proxy(at("nobody.wonderid.example", "/sign-in"));
    expect(page.status).toBe(404);
    expect(page.headers.get("x-middleware-rewrite")).toMatch(/\/tenant-not-found$/);
    const api = await proxy(at("nobody.wonderid.example", "/api/v1/agents"));
    expect(api.status).toBe(404);
    expect((await api.json()).error.code).toBe("TENANT_NOT_FOUND");
  });

  it("a malformed or reserved address is a 404 without asking the database", async () => {
    expect((await proxy(at("www.wonderid.example", "/"))).status).toBe(404);
    expect((await proxy(at("a.b.wonderid.example", "/"))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an organization's address passes to the app (sign-in is public), and the lookup is cached", async () => {
    knownLabels.add("acme-corp");
    const first = await proxy(at("acme-corp.wonderid.example", "/sign-in"));
    expect(first.status).toBe(200);
    expect(first.headers.get("x-middleware-rewrite")).toBeNull();
    await proxy(at("acme-corp.wonderid.example", "/help"));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("signed out, the organization's address opens its sign-in page, not the marketing page or sign-up", async () => {
    knownLabels.add("acme-corp");
    for (const path of ["/", "/welcome", "/sign-up"]) {
      const res = await proxy(at("acme-corp.wonderid.example", path));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toMatch(/\/sign-in$/);
    }
  });

  it("a failed lookup fails closed as unavailable, never as another organization", async () => {
    lookupFails = true;
    const page = await proxy(at("beta-corp.wonderid.example", "/"));
    expect(page.status).toBe(503);
    expect(page.headers.get("x-middleware-rewrite")).toMatch(/\/service-unavailable$/);
  });

  it("the bare host and hosts outside the scheme are unchanged", async () => {
    expect((await proxy(at("wonderid.example", "/help"))).status).toBe(200);
    expect((await proxy(at("preview.vercel.app", "/help"))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
});
