// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let getUserResult: { data: { user: null }; error: unknown } = { data: { user: null }, error: null };
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => getUserResult, signOut: vi.fn() } }) }));
vi.mock("@/lib/db/env", () => ({ getOptionalSupabaseUrl: () => "https://example.supabase.co", getOptionalSupabasePublishableKey: () => "pk" }));
vi.mock("@/lib/tenant/getTenantContext", () => ({ TENANT_COOKIE_NAME: "wa_tenant" }));

import { proxy } from "./proxy";

const withSession = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { cookie: "sb-abc-auth-token=x" } });

beforeEach(() => {
  getUserResult = { data: { user: null }, error: null };
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
