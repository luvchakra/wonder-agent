import { describe, expect, it } from "vitest";
import { DefinitionConnector, httpDriver } from "./engine";
import type { FetchLike } from "./http";
import { scim } from "./definitions/scim";

/** INTEGRATION-P0-22: the built-in SCIM 2.0 connection type against a fake SCIM service. */
const users = Array.from({ length: 150 }, (_, i) => ({ id: `u${i}`, userName: `User${i}@Example.test`, active: i !== 3, emails: i === 0 ? [{ value: "First@Example.test", primary: true }] : undefined }));
const groups = [
  { id: "g1", displayName: "Finance", members: [{ value: "u1" }, { value: "u2" }] },
  { id: "g2", displayName: "Ops", members: [] },
];

function fakeScim() {
  const calls: { method: string; path: string; body?: unknown; auth?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/scim+json" } });
    const start = Number(u.searchParams.get("startIndex") ?? 1);
    const count = Number(u.searchParams.get("count") ?? 100);
    if (u.pathname === "/scim/v2/ServiceProviderConfig") return json({ patch: { supported: true } });
    if (u.pathname === "/scim/v2/Users" && init.method === "POST") return json({ id: "u-new" }, 201);
    if (u.pathname === "/scim/v2/Users") return json({ totalResults: users.length, startIndex: start, itemsPerPage: count, Resources: users.slice(start - 1, start - 1 + count) });
    if (u.pathname === "/scim/v2/Groups") return json({ totalResults: groups.length, Resources: groups });
    if (init.method === "PATCH") return new Response(null, { status: 204 });
    return json({ detail: "not found" }, 404);
  };
  return { fetchImpl, calls };
}

const config = { definition: { key: scim.key, version: scim.version, origin: "builtin" }, settings: { baseUrl: "https://app.example.test/scim/v2", application: "Example App" } };

describe("SCIM 2.0 connection type (INTEGRATION-P0-22)", () => {
  it("reads every user across SCIM pages, groups and memberships", async () => {
    const { fetchImpl, calls } = fakeScim();
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate(config, JSON.stringify({ token: "t0k" }));
    expect((await c.testConnection()).ok).toBe(true);
    const accounts = await c.importAccounts();
    expect(accounts).toHaveLength(150);
    expect(calls.filter((x) => x.path.startsWith("/scim/v2/Users?")).map((x) => x.path)).toEqual(["/scim/v2/Users?startIndex=1&count=100", "/scim/v2/Users?startIndex=101&count=100"]);
    expect(accounts[0].normalized).toMatchObject({ externalId: "u0", email: "first@example.test", username: "User0@Example.test", status: "active", application: "Example App" });
    expect(accounts[3].normalized).toMatchObject({ status: "disabled", email: "user3@example.test" });
    expect((await c.importEntitlements()).map((e) => e.normalized)).toEqual([expect.objectContaining({ externalId: "g1", name: "Finance" }), expect.objectContaining({ externalId: "g2", name: "Ops" })]);
    expect((await c.importAccess()).map((g) => g.externalId)).toEqual(["g1:u1", "g1:u2"]);
    expect(calls.every((x) => x.auth === "Bearer t0k")).toBe(true);
  });

  it("makes the four changes as RFC 7644 requests", async () => {
    const { fetchImpl, calls } = fakeScim();
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate(config, JSON.stringify({ token: "t0k" }));
    await c.write("revoke_access", { account: "u1", entitlement: "g1" }, "k1");
    await c.write("grant_access", { account: "u5", entitlement: "g2" }, "k2");
    await c.write("disable_account", { account: "u5" }, "k3");
    await c.write("create_account", { email: "new@example.test", displayName: "New Person" }, "k4");
    const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
    expect(calls.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "PATCH", path: "/scim/v2/Groups/g1", body: { schemas: [PATCH], Operations: [{ op: "remove", path: 'members[value eq "u1"]' }] } },
      { method: "PATCH", path: "/scim/v2/Groups/g2", body: { schemas: [PATCH], Operations: [{ op: "add", path: "members", value: [{ value: "u5" }] }] } },
      { method: "PATCH", path: "/scim/v2/Users/u5", body: { schemas: [PATCH], Operations: [{ op: "replace", path: "active", value: false }] } },
      {
        method: "POST",
        path: "/scim/v2/Users",
        body: { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: "new@example.test", displayName: "New Person", emails: [{ value: "new@example.test", primary: true }], active: true },
      },
    ]);
  });
});
