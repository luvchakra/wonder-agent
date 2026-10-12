import { describe, expect, it } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { applyTransform, fillTemplate, mapField, mapRecord, matchesFilters, readPath, TemplateError } from "./mapping";
import { validateDefinition, validateSecrets, validateSettings } from "./validate";
import { HttpSession, parseLinkNext, type FetchLike } from "./http";
import { DefinitionConnector, capabilitiesOf, httpDriver, writeCapabilitiesOf } from "./engine";
import type { ConnectorDefinition, ResourceSpec } from "./types";

const base: ConnectorDefinition = {
  schemaVersion: 1,
  key: "acme-hr",
  version: "1.0.0",
  name: "Acme HR",
  category: "hr",
  description: "Test HR system",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
  auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "API token" }] },
  test: { request: { path: "/api/ping" } },
  resources: {
    identity: {
      request: { path: "/api/people" },
      records: "data",
      pagination: { type: "page", param: "page", sizeParam: "per_page", size: 2 },
      fields: {
        externalId: "id",
        displayName: { template: "{record.first} {record.last}" },
        email: { path: "mail", transform: ["lower"] },
        status: { path: "state", transform: [{ map: { Active: "active", Left: "terminated" }, default: "active" }] },
        managerExternalId: "manager.id",
      },
    },
  },
};

const idSpec = base.resources.identity as ResourceSpec;

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...init });

describe("mapping", () => {
  it("reads paths, spreads arrays and indexes", () => {
    const r = { a: { b: 1 }, groups: [{ name: "x" }, { name: "y" }], list: ["p", "q"], "dotted.key": 5 };
    expect(readPath(r, "a.b")).toBe(1);
    expect(readPath(r, "groups[].name")).toEqual(["x", "y"]);
    expect(readPath(r, "list[1]")).toBe("q");
    expect(readPath(r, "dotted.key")).toBe(5);
    expect(readPath(r, "missing.deep")).toBeUndefined();
  });

  it("fills templates and refuses a missing value", () => {
    expect(fillTemplate("/realms/{settings.realm}/users", { settings: { realm: "planet express" } }, { encode: true })).toBe("/realms/planet%20express/users");
    expect(() => fillTemplate("/x/{settings.nope}", { settings: {} })).toThrow(TemplateError);
    expect(fillTemplate("{record.a} {record.b}", { record: { a: "A" } }, { allowMissing: true })).toBe("A ");
  });

  it("applies the closed transform list", () => {
    expect(applyTransform("Ava@X.COM", "lower")).toBe("ava@x.com");
    expect(applyTransform(["a", "b"], "first")).toBe("a");
    expect(applyTransform("yes", "boolean")).toBe(true);
    expect(applyTransform(true, "not")).toBe(false);
    expect(applyTransform("20240131120000Z", "date")).toBe("2024-01-31");
    expect(applyTransform(1706745600, "date")).toBe("2024-02-01");
    expect(applyTransform("a, b,,c", "split")).toEqual(["a", "b", "c"]);
    expect(applyTransform("LEFT", { map: { Left: "terminated" } })).toBe("terminated");
    expect(applyTransform("Other", { map: { Left: "terminated" }, default: "active" })).toBe("active");
    expect(applyTransform("service-account-bot", { prefix: "service-account-" })).toBe(true);
    expect(applyTransform(undefined, { prefix: "service-account-" })).toBe(false);
    expect(applyTransform("system_user system_admin", { contains: "system_admin" })).toBe(true);
    expect(applyTransform("system_user", { contains: "system_admin" })).toBe(false);
    expect(applyTransform(["a", "b"], { contains: "b" })).toBe(true);
    expect(applyTransform(["", "x"], "present")).toBe(true);
    expect(applyTransform([], "present")).toBe(false);
  });

  it("maps a record and reports a missing required field", () => {
    const fields = idSpec.fields;
    const ok = mapRecord("identity", fields, { record: { id: 7, first: "Ava", last: "Chen", mail: "AVA@X.COM", state: "Left", manager: { id: 3 } } });
    expect(ok).toEqual({ externalId: "7", normalized: { externalId: "7", displayName: "Ava Chen", email: "ava@x.com", status: "terminated", managerExternalId: 3 } });
    expect(mapRecord("identity", fields, { record: { first: "No id" } })).toEqual({ invalid: "identity: no value for externalId" });
  });

  it("keeps array fields as arrays only where the canonical field is a list", () => {
    const r = mapRecord("account", { externalId: "id", entitlements: "roles[].name", username: "names" }, { record: { id: "u1", roles: [{ name: "a" }, { name: "b" }], names: ["x", "y"] } }, { application: "App" });
    expect(r).toEqual({ externalId: "u1", normalized: { externalId: "u1", entitlements: ["a", "b"], username: "x, y", application: "App" } });
  });

  it("filters records", () => {
    expect(matchesFilters({ name: "Guest" }, [{ path: "name", notIn: ["Guest", "Administrator"] }])).toBe(false);
    expect(matchesFilters({ enabled: true }, [{ path: "enabled", equals: true }])).toBe(true);
    expect(matchesFilters({}, [{ path: "email", exists: true }])).toBe(false);
  });
});

describe("validateDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(validateDefinition(base)).toEqual({ definition: base, issues: [] });
  });

  const issuesOf = (d: unknown) => validateDefinition(d).issues.map((i) => `${i.path}: ${i.message}`);

  it("refuses a secret outside the auth block", () => {
    const d = { ...base, resources: { identity: { ...idSpec, request: { path: "/api/people", query: { key: "{secret.token}" } } } } };
    expect(issuesOf(d).join("\n")).toMatch(/secrets may only be used in the auth block/);
  });

  it("refuses an absolute request URL, so a definition cannot send credentials elsewhere", () => {
    const d = { ...base, test: { request: { path: "https://evil.example/steal" } } };
    expect(issuesOf(d).join("\n")).toMatch(/test.request.path: must be a path relative/);
    const d2 = { ...base, test: { request: { path: "//evil.example/x" } } };
    expect(issuesOf(d2).join("\n")).toMatch(/relative/);
  });

  it("refuses an OAuth token URL that is not relative or from a url setting", () => {
    const d = { ...base, auth: { type: "oauth2_client_credentials", tokenUrl: "https://evil.example/token", clientId: "{secret.id}", clientSecret: "{secret.s}", fields: [{ key: "id", label: "Id" }, { key: "s", label: "Secret" }] } };
    expect(issuesOf(d).join("\n")).toMatch(/auth.tokenUrl/);
  });

  it("checks templates, fields and transforms", () => {
    const d = {
      ...base,
      resources: { identity: { ...idSpec, request: { path: "/api/{settings.tenant}" }, fields: { displayName: "name", colour: "c", email: { path: "m", transform: ["shout"] } } } },
    };
    const out = issuesOf(d).join("\n");
    expect(out).toMatch(/names no setting/);
    expect(out).toMatch(/fields.colour: is not a identity field/);
    expect(out).toMatch(/fields.externalId: is required/);
    expect(out).toMatch(/transform\[0\]/);
  });

  it("only allows read-only single statements for sql", () => {
    const sql = (query: string) => ({
      ...base,
      driver: "sql",
      settings: [{ key: "url", label: "Database", type: "url" }],
      auth: { type: "sql_password", username: "{secret.u}", password: "{secret.p}", fields: [{ key: "u", label: "User" }, { key: "p", label: "Password" }] },
      test: { query: "select 1" },
      resources: { account: { query, fields: { externalId: "rolname" } } },
    });
    expect(issuesOf(sql("select rolname from pg_roles"))).toEqual([]);
    expect(issuesOf(sql("select 1; drop table users")).join("\n")).toMatch(/single statement/);
    expect(issuesOf(sql("delete from users")).join("\n")).toMatch(/SELECT/);
    expect(issuesOf(sql("with x as (update t set a=1 returning *) select * from x")).join("\n")).toMatch(/may only read/);
  });

  it("requires forEach to name another, existing resource", () => {
    const d = { ...base, resources: { ...base.resources, access_grant: { forEach: "entitlement", request: { path: "/g/{parent.id}" }, fields: { externalId: "id", accountExternalId: "id", entitlementExternalId: "id" } } } };
    expect(issuesOf(d).join("\n")).toMatch(/there is no entitlement resource/);
  });
});

describe("settings and secrets", () => {
  it("validates url settings and refuses credentials in the address", () => {
    expect(validateSettings(base, { baseUrl: "https://hr.acme.example/" })).toEqual({ settings: { baseUrl: "https://hr.acme.example" }, issues: [] });
    expect(validateSettings(base, { baseUrl: "ftp://x" }).issues[0].message).toMatch(/https/);
    expect(validateSettings(base, { baseUrl: "https://u:p@x.example" }).issues[0].message).toMatch(/must not contain/);
    expect(validateSettings(base, {}).issues[0].message).toMatch(/required/);
  });

  it("stores the secret fields as JSON, every one required", () => {
    expect(validateSecrets(base, { token: " t0k " })).toEqual({ secret: '{"token":"t0k"}', issues: [] });
    expect(validateSecrets(base, {}).issues[0].message).toMatch(/API token is required/);
  });
});

function fakeFetch(handler: (url: URL, init: { method?: string; headers?: Record<string, string>; body?: string }) => Response | Promise<Response>) {
  const calls: { url: URL; headers: Record<string, string>; method: string; body?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, headers: init.headers ?? {}, method: init.method ?? "GET", body: init.body });
    return handler(u, init);
  };
  return { fetchImpl, calls };
}

const fast = { ...base, rateLimitPerSecond: 50 };

describe("HttpSession", () => {
  it("pages by page number until a short page", async () => {
    const pages: Record<string, unknown[]> = { "1": [{ id: 1 }, { id: 2 }], "2": [{ id: 3 }, { id: 4 }], "3": [{ id: 5 }] };
    const { fetchImpl, calls } = fakeFetch((u) => json({ data: pages[u.searchParams.get("page")!] ?? [] }));
    const s = new HttpSession(fast, { baseUrl: "https://hr.example" }, { token: "t" }, fetchImpl);
    const out = await s.fetchAll(idSpec.request!, "data", idSpec.pagination, { settings: {} }, 100);
    expect(out).toHaveLength(5);
    expect(calls.map((c) => c.url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(calls[0].headers.Authorization).toBe("Bearer t");
    expect(calls[0].url.searchParams.get("per_page")).toBe("2");
  });

  it("pages by item offset, by cursor, by Link header and SCIM index", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const offset = fakeFetch((u) => json(items.slice(Number(u.searchParams.get("first")), Number(u.searchParams.get("first")) + 2)));
    const s1 = new HttpSession(fast, { baseUrl: "https://kc.example" }, { token: "t" }, offset.fetchImpl);
    expect(await s1.fetchAll({ path: "/users" }, "", { type: "offset", param: "first", sizeParam: "max", size: 2 }, {}, 100)).toHaveLength(5);

    const cursor = fakeFetch((u) => {
      const c = Number(u.searchParams.get("continue") ?? 0);
      return json({ items: items.slice(c, c + 2), metadata: { continue: c + 2 < 5 ? String(c + 2) : "" } });
    });
    const s2 = new HttpSession(fast, { baseUrl: "https://k8s.example" }, { token: "t" }, cursor.fetchImpl);
    expect(await s2.fetchAll({ path: "/api/v1/serviceaccounts" }, "items", { type: "cursor", param: "continue", from: "metadata.continue" }, {}, 100)).toHaveLength(5);

    const link = fakeFetch((u) => {
      const p = Number(u.searchParams.get("page") ?? 1);
      const next = p < 3 ? `<https://git.example/api/v1/users?page=${p + 1}>; rel="next"` : "";
      return json(items.slice((p - 1) * 2, p * 2), { headers: next ? { link: next } : {} });
    });
    const s3 = new HttpSession(fast, { baseUrl: "https://git.example" }, { token: "t" }, link.fetchImpl);
    expect(await s3.fetchAll({ path: "/api/v1/users" }, "", { type: "link_header" }, {}, 100)).toHaveLength(5);

    const scim = fakeFetch((u) => {
      const start = Number(u.searchParams.get("startIndex"));
      return json({ totalResults: 5, Resources: items.slice(start - 1, start + 1) });
    });
    const s4 = new HttpSession(fast, { baseUrl: "https://scim.example" }, { token: "t" }, scim.fetchImpl);
    expect(await s4.fetchAll({ path: "/scim/v2/Users" }, undefined, { type: "scim", size: 2 }, {}, 100)).toHaveLength(5);
  });

  it("reads records keyed by id, and plain values as { value }", async () => {
    const keyed = fakeFetch(() => json({ ocs: { data: { users: { ava: { id: "ava", groups: ["admin"] }, bo: { id: "bo" } } } } }));
    const s1 = new HttpSession(fast, { baseUrl: "https://cloud.example" }, { token: "t" }, keyed.fetchImpl);
    expect(await s1.fetchAll({ path: "/u" }, "ocs.data.users", undefined, {}, 100, true)).toEqual([
      { id: "ava", groups: ["admin"], _key: "ava" },
      { id: "bo", _key: "bo" },
    ]);
    const plain = fakeFetch(() => json({ ocs: { data: { users: ["ava", "bo"] } } }));
    const s2 = new HttpSession(fast, { baseUrl: "https://cloud.example" }, { token: "t" }, plain.fetchImpl);
    expect(await s2.fetchAll({ path: "/g" }, "ocs.data.users", undefined, {}, 100)).toEqual([{ value: "ava" }, { value: "bo" }]);
  });

  it("stops at maxRecords", async () => {
    const { fetchImpl } = fakeFetch(() => json({ data: [{ id: 1 }, { id: 2 }] }));
    const s = new HttpSession(fast, { baseUrl: "https://hr.example" }, { token: "t" }, fetchImpl);
    expect(await s.fetchAll(idSpec.request!, "data", idSpec.pagination, {}, 3)).toHaveLength(3);
  });

  it("refuses a next-page link to another origin", async () => {
    const { fetchImpl } = fakeFetch(() => json([{ id: 1 }], { headers: { link: '<https://evil.example/x>; rel="next"' } }));
    const s = new HttpSession(fast, { baseUrl: "https://git.example" }, { token: "t" }, fetchImpl);
    await expect(s.fetchAll({ path: "/users" }, "", { type: "link_header" }, {}, 100)).rejects.toThrow(/not this connection's address/);
  });

  it("gets an OAuth token, reuses it, and refreshes it once on 401", async () => {
    const def: ConnectorDefinition = {
      ...fast,
      auth: { type: "oauth2_client_credentials", tokenUrl: "{settings.baseUrl}/realms/x/token", clientId: "{secret.id}", clientSecret: "{secret.secret}", fields: [{ key: "id", label: "Client id" }, { key: "secret", label: "Client secret" }] },
    };
    let tokens = 0;
    let rejectOnce = true;
    const { fetchImpl, calls } = fakeFetch((u, init) => {
      if (u.pathname.endsWith("/token")) {
        tokens++;
        expect(init.body).toContain("grant_type=client_credentials");
        expect(init.body).toContain("client_secret=s3cret");
        return json({ access_token: `tok${tokens}`, expires_in: 300 });
      }
      if (rejectOnce) {
        rejectOnce = false;
        return new Response("", { status: 401 });
      }
      return json({ ok: true });
    });
    const s = new HttpSession(def, { baseUrl: "https://kc.example" }, { id: "wonderid", secret: "s3cret" }, fetchImpl);
    await s.send({ path: "/a" }, {});
    await s.send({ path: "/b" }, {});
    expect(tokens).toBe(2);
    expect(calls.filter((c) => !c.url.pathname.endsWith("/token")).map((c) => c.headers.Authorization)).toEqual(["Bearer tok1", "Bearer tok2", "Bearer tok2"]);
  });

  it("never puts a query-string credential in an error message", async () => {
    const def: ConnectorDefinition = { ...fast, auth: { type: "query", name: "api_key", value: "{secret.token}", fields: [{ key: "token", label: "Key" }] } };
    const { fetchImpl, calls } = fakeFetch(() => new Response("no", { status: 403 }));
    const s = new HttpSession(def, { baseUrl: "https://hr.example" }, { token: "SUPERSECRET" }, fetchImpl);
    await expect(s.send({ path: "/api/people" }, {})).rejects.toThrow("GET /api/people failed: HTTP 403");
    expect(calls[0].url.searchParams.get("api_key")).toBe("SUPERSECRET");
  });

  it("parses Link headers", () => {
    expect(parseLinkNext('<https://a/x?page=2>; rel="next", <https://a/x?page=9>; rel="last"')).toBe("https://a/x?page=2");
    expect(parseLinkNext(null)).toBeNull();
  });
});

describe("DefinitionConnector", () => {
  const def: ConnectorDefinition = {
    ...fast,
    key: "acme-idp",
    category: "identity_provider",
    application: "Acme ({settings.realm})",
    settings: [
      { key: "baseUrl", label: "Address", type: "url", required: true },
      { key: "realm", label: "Realm", type: "string", required: true },
    ],
    resources: {
      account: { request: { path: "/users" }, records: "", where: [{ path: "username", notEquals: "service-account-x" }], fields: { externalId: "id", username: "username", status: { path: "enabled", transform: [{ map: { true: "active", false: "disabled" } }] } } },
      entitlement: { request: { path: "/groups" }, records: "", fields: { externalId: "id", name: "name", type: { value: "group" } } },
      access_grant: {
        forEach: "entitlement",
        request: { path: "/groups/{parent.id}/members" },
        records: "",
        fields: { externalId: { template: "{parent.id}:{record.id}" }, accountExternalId: "id", entitlementExternalId: "parent.id" },
      },
    },
  };
  const config = { definition: { key: def.key, version: def.version, origin: "builtin" }, manifest: def, settings: { baseUrl: "https://idp.example", realm: "pe" } };

  it("imports accounts, groups and memberships, and reports unmappable records", async () => {
    const { fetchImpl, calls } = fakeFetch((u) => {
      if (u.pathname === "/api/ping") return json({ ok: true });
      if (u.pathname === "/users") return json([{ id: "u1", username: "fry", enabled: true }, { id: "u2", username: "service-account-x", enabled: true }, { username: "no-id" }]);
      if (u.pathname === "/groups") return json([{ id: "g1", name: "ship_crew" }, { id: "g2", name: "admin_staff" }]);
      if (u.pathname === "/groups/g1/members") return json([{ id: "u1" }]);
      if (u.pathname === "/groups/g2/members") return json([]);
      return new Response("", { status: 404 });
    });
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate(config, JSON.stringify({ token: "t" }));
    expect(c.capabilities).toMatchObject({ importAccounts: true, importEntitlements: true, importAccess: true, importIdentities: false });
    expect(await c.testConnection()).toEqual({ ok: true });

    const accounts = await c.importAccounts();
    expect(accounts.map((a) => a.normalized)).toEqual([{ externalId: "u1", username: "fry", status: "active", application: "Acme (pe)" }]);
    expect(c.drainIssues()).toEqual([{ objectType: "account", message: "account: no value for externalId" }]);

    const grants = await c.importAccess();
    expect(grants.map((g) => g.normalized)).toEqual([{ externalId: "g1:u1", accountExternalId: "u1", entitlementExternalId: "g1" }]);
    // The groups were fetched once and reused for their members.
    expect(calls.filter((x) => x.url.pathname === "/groups")).toHaveLength(1);
  });

  it("reports a complete read, and a capped one as truncated for the kind and its forEach children (INTEGRATION-P0-18)", async () => {
    const handler = (u: URL) => {
      if (u.pathname === "/users") return json([{ id: "u1", username: "fry", enabled: true }]);
      if (u.pathname === "/groups") return json([{ id: "g1", name: "ship_crew" }, { id: "g2", name: "admin_staff" }]);
      if (u.pathname.startsWith("/groups/")) return json([{ id: "u1" }]);
      return new Response("", { status: 404 });
    };
    const c = new DefinitionConnector({ http: httpDriver(fakeFetch(handler).fetchImpl) });
    await c.authenticate(config, JSON.stringify({ token: "t" }));
    await c.importAccounts();
    await c.importAccess();
    expect(c.readReport("account")).toEqual({ truncated: false, unread: false });
    expect(c.readReport("entitlement")).toEqual({ truncated: false, unread: false });
    expect(c.readReport("access_grant")).toEqual({ truncated: false, unread: false });

    // The same source with the groups resource capped at one record.
    const capped = { ...config, manifest: { ...def, resources: { ...def.resources, entitlement: { ...(def.resources.entitlement as ResourceSpec), maxRecords: 1 } } } };
    const c2 = new DefinitionConnector({ http: httpDriver(fakeFetch(handler).fetchImpl) });
    await c2.authenticate(capped, JSON.stringify({ token: "t" }));
    await c2.importEntitlements();
    await c2.importAccess();
    expect(c2.readReport("entitlement").truncated).toBe(true);
    // Memberships were read for the first group only, so they are incomplete too.
    expect(c2.readReport("access_grant").truncated).toBe(true);
    expect(c2.readReport("account")).toEqual({ truncated: false, unread: false });
  });

  it("reports a kind the driver had nothing to read as unread", async () => {
    const fileDef: ConnectorDefinition = { ...def, driver: "file", auth: { type: "none" }, test: undefined, receive: { file: { auth: "bearer" } }, resources: { account: { file: {}, fields: { externalId: "id" } } } };
    const c = new DefinitionConnector({
      file: async () => ({
        async test() {},
        async fetch(_spec, _scope, _max, _kind, report) {
          if (report) report.unread = true;
          return [];
        },
      }),
    });
    await c.authenticate({ manifest: fileDef, settings: { baseUrl: "https://idp.example", realm: "pe" } }, null);
    expect(await c.importAccounts()).toEqual([]);
    expect(c.readReport("account")).toEqual({ truncated: false, unread: true });
  });

  it("needs credentials before it runs, and refuses a tampered definition", async () => {
    const c = new DefinitionConnector({ http: httpDriver(fakeFetch(() => json({})).fetchImpl) });
    await expect(c.authenticate(config, null)).rejects.toThrow(/no credentials/);
    await expect(c.authenticate({ ...config, manifest: { ...def, test: { request: { path: "https://evil.example" } } } }, '{"token":"t"}')).rejects.toThrow(/invalid/);
  });

  it("combines several requests for one kind and unwinds list fields", async () => {
    const multi: ConnectorDefinition = {
      ...def,
      resources: {
        account: { request: { path: "/users" }, records: "", fields: { externalId: "id", accountType: { path: "serviceClient", transform: ["present", { map: { true: "service", false: "human" } }] } } },
        entitlement: [
          { request: { path: "/groups" }, records: "", fields: { externalId: { template: "group:{record.id}" }, name: "name", type: { value: "group" } } },
          { request: { path: "/roles" }, records: "", fields: { externalId: { template: "role:{record.id}" }, name: "name", type: { value: "role" } } },
        ],
        access_grant: {
          request: { path: "/groups" },
          records: "",
          unwind: "members",
          fields: { externalId: { template: "{parent.id}:{record.value}" }, accountExternalId: "value", entitlementExternalId: { template: "group:{parent.id}" } },
        },
      },
    };
    const { fetchImpl } = fakeFetch((u) => {
      if (u.pathname === "/users") return json([{ id: "u1" }, { id: "u2", serviceClient: "financebot" }]);
      if (u.pathname === "/groups") return json([{ id: "g1", name: "crew", members: ["u1", "u2"] }, { id: "g2", name: "empty" }]);
      if (u.pathname === "/roles") return json([{ id: "r1", name: "admin" }]);
      return new Response("", { status: 404 });
    });
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate({ ...config, manifest: multi }, JSON.stringify({ token: "t" }));
    expect((await c.importAccounts()).map((a) => (a.normalized as Record<string, unknown> | undefined)?.accountType)).toEqual(["human", "service"]);
    expect((await c.importEntitlements()).map((e) => e.externalId)).toEqual(["group:g1", "group:g2", "role:r1"]);
    expect((await c.importAccess()).map((g) => g.normalized)).toEqual([
      { externalId: "g1:u1", accountExternalId: "u1", entitlementExternalId: "group:g1" },
      { externalId: "g1:u2", accountExternalId: "u2", entitlementExternalId: "group:g1" },
    ]);
  });

  it("follows only the chosen request of a combined parent kind", async () => {
    const d: ConnectorDefinition = {
      ...def,
      resources: {
        account: [
          { request: { path: "/approles" }, records: "", fields: { externalId: { template: "approle:{record.value}" } } },
          { request: { path: "/users" }, records: "", fields: { externalId: { template: "user:{record.value}" } } },
        ],
        access_grant: {
          forEach: "account",
          forEachRequest: 0,
          request: { path: "/approles/{parent.value}" },
          records: "policies",
          fields: { externalId: { template: "{parent.value}:{record.value}" }, accountExternalId: { template: "approle:{parent.value}" }, entitlementExternalId: "value" },
        },
      },
    };
    const { fetchImpl, calls } = fakeFetch((u) => {
      if (u.pathname === "/approles") return json(["ci"]);
      if (u.pathname === "/users") return json(["ava"]);
      if (u.pathname === "/approles/ci") return json({ policies: ["deploy"] });
      return new Response("", { status: 404 });
    });
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate({ ...config, manifest: d }, JSON.stringify({ token: "t" }));
    expect((await c.importAccess()).map((g) => g.externalId)).toEqual(["ci:deploy"]);
    expect(calls.some((x) => x.url.pathname === "/approles/ava")).toBe(false);
    expect(validateDefinition({ ...d, resources: { ...d.resources, access_grant: { ...(d.resources.access_grant as ResourceSpec), forEachRequest: 2 } } }).issues[0]?.path).toBe("resources.access_grant.forEachRequest");
  });

  it("treats a 404 on an optional request as none, and filters on prefixes and parent fields", async () => {
    const d: ConnectorDefinition = {
      ...def,
      resources: {
        account: [
          { request: { path: "/missing" }, records: "", optional: true, fields: { externalId: "id" } },
          { request: { path: "/users" }, records: "", where: [{ path: "name", notPrefix: "system:" }], fields: { externalId: "name" } },
        ],
        access_grant: {
          request: { path: "/bindings" },
          records: "",
          unwind: "subjects",
          where: [{ path: "parent.roleRef.kind", equals: "Role" }, { path: "kind", prefix: "Service" }],
          fields: { externalId: { template: "{parent.name}:{record.name}" }, accountExternalId: "name", entitlementExternalId: "parent.roleRef.name" },
        },
      },
    };
    const { fetchImpl } = fakeFetch((u) => {
      if (u.pathname === "/users") return json([{ name: "system:kube" }, { name: "app" }]);
      if (u.pathname === "/bindings")
        return json([
          { name: "b1", roleRef: { kind: "Role", name: "r1" }, subjects: [{ kind: "ServiceAccount", name: "app" }, { kind: "User", name: "ava" }] },
          { name: "b2", roleRef: { kind: "ClusterRole", name: "c1" }, subjects: [{ kind: "ServiceAccount", name: "app" }] },
        ]);
      return new Response("", { status: 404 });
    });
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate({ ...config, manifest: d }, JSON.stringify({ token: "t" }));
    expect((await c.importAccounts()).map((a) => a.externalId)).toEqual(["app"]);
    expect((await c.importAccess()).map((g) => g.externalId)).toEqual(["b1:app"]);
    const strict = { ...d, resources: { account: { ...(d.resources.account as ResourceSpec[])[0], optional: false } } };
    const c2 = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c2.authenticate({ ...config, manifest: strict }, JSON.stringify({ token: "t" }));
    await expect(c2.importAccounts()).rejects.toThrow(/404/);
  });

  it("validates each request of a combined kind", () => {
    const bad = { ...def, resources: { entitlement: [{ request: { path: "/groups" }, fields: { externalId: "id", name: "name" } }, { request: { path: "https://evil.example/roles" }, fields: { externalId: "id", name: "name" } }] } };
    expect(validateDefinition(bad).issues.some((i) => i.path.startsWith("resources.entitlement[1]"))).toBe(true);
  });
});

describe("writes (INTEGRATION-P0-11 / P0-13)", () => {
  const writer: ConnectorDefinition = {
    ...fast,
    key: "acme-writer",
    settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
    resources: { account: { request: { path: "/users" }, records: "", fields: { externalId: "id" } } },
    write: {
      revoke_access: { request: { method: "DELETE", path: "/groups/{target.entitlement}/members/{target.account}" } },
      disable_account: { request: { method: "PATCH", path: "/users/{target.account}", body: { enabled: false, note: "by {settings.baseUrl}" } } },
      grant_access: { request: { method: "PUT", path: "/groups/{target.entitlement}/members/{target.account}" } },
      create_account: { request: { method: "POST", path: "/users", body: { userName: "{target.username}", email: "{target.email}", name: "{target.displayName}" } } },
    },
  };
  const config = { definition: { key: writer.key, version: writer.version, origin: "custom" }, manifest: writer, settings: { baseUrl: "https://acme.example" } };

  it("accepts a write section on an http connector", () => {
    expect(validateDefinition(writer).issues).toEqual([]);
  });

  it("refuses writes that name no target, unknown operations, a GET, other drivers and stray variables", () => {
    const bad = (write: unknown, extra: Partial<ConnectorDefinition> = {}) => validateDefinition({ ...writer, ...extra, write }).issues.map((i) => `${i.path}: ${i.message}`).join("\n");
    expect(bad({ revoke_access: { request: { method: "DELETE", path: "/groups/{target.entitlement}" } } })).toMatch(/must use \{target.account\}/);
    expect(bad({ revoke_access: { request: { method: "DELETE", path: "/users/{target.account}" } } })).toMatch(/must use \{target.entitlement\}/);
    expect(bad({ grant_access: { request: { method: "POST", path: "/users/{target.account}" } } })).toMatch(/write.grant_access.request: must use \{target.entitlement\}/);
    expect(bad({ create_account: { request: { method: "POST", path: "/users", body: { name: "{target.displayName}" } } } })).toMatch(/must use \{target.email\} or \{target.username\}/);
    expect(bad({ delete_account: { request: { method: "DELETE", path: "/users/{target.account}" } } })).toMatch(/write.delete_account: must be one of revoke_access, disable_account, grant_access, create_account/);
    expect(bad({ disable_account: { request: { method: "GET", path: "/users/{target.account}" } } })).toMatch(/method: must be POST, PUT, PATCH, DELETE/);
    expect(bad({ disable_account: { request: { path: "/users/{target.account}" } } })).toMatch(/method: is required/);
    expect(bad({ disable_account: { request: { method: "PUT", path: "/users/{target.account}", body: { by: "{record.id}" } } } })).toMatch(/\{record.id\}" is not allowed here/);
    expect(bad({ disable_account: { request: { method: "PUT", path: "/users/{target.who}" } } })).toMatch(/must be one of \{target.account\}, \{target.entitlement\}/);
    expect(bad({ disable_account: { request: { method: "PUT", path: "/u/{target.account}", body: { k: "{secret.token}" } } } })).toMatch(/secrets may only be used in the auth block/);
    // Reads still may not delete.
    expect(validateDefinition({ ...writer, resources: { account: { request: { method: "DELETE", path: "/users" }, records: "", fields: { externalId: "id" } } } }).issues.map((i) => i.message).join()).toMatch(/must be GET, POST/);
  });

  it("supports writes, but never declares them on its own", () => {
    expect(capabilitiesOf(writer)).toMatchObject({ provision: false, deprovision: false });
    expect(capabilitiesOf(writer).revokeAccess).toBeUndefined();
    expect(writeCapabilitiesOf(writer)).toEqual({ revokeAccess: true, disableAccount: true, grantAccess: true, createAccount: true, deprovision: true, provision: true });
    expect(writeCapabilitiesOf(base)).toEqual({ revokeAccess: false, disableAccount: false, grantAccess: false, createAccount: false, deprovision: false, provision: false });
  });

  it("sends the declared request with the target filled in and the idempotency key", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate(config, JSON.stringify({ token: "t" }));
    await c.write("revoke_access", { account: "u 1", entitlement: "g/1" }, "fulfil:task:1");
    await c.write("disable_account", { account: "u1" }, "fulfil:task:2");
    await c.write("grant_access", { account: "u1", entitlement: "g1" }, "fulfil:task:3");
    await c.write("create_account", { email: "dee@acme.example", username: "dee", displayName: "Dee" }, "fulfil:task:4");
    expect(calls.map((x) => `${x.method} ${x.url.pathname}`)).toEqual(["DELETE /groups/g%2F1/members/u%201", "PATCH /users/u1", "PUT /groups/g1/members/u1", "POST /users"]);
    expect(calls[0].headers["Idempotency-Key"]).toBe("fulfil:task:1");
    expect(JSON.parse(calls[1].body!)).toEqual({ enabled: false, note: "by https://acme.example" });
    expect(JSON.parse(calls[3].body!)).toEqual({ userName: "dee", email: "dee@acme.example", name: "Dee" });
  });

  it("fails truthfully: an undeclared operation, a missing target, an error response", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("{}", { status: 500 }));
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate(config, JSON.stringify({ token: "t" }));
    const readOnly = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await readOnly.authenticate({ ...config, manifest: { ...writer, write: { disable_account: writer.write!.disable_account } } }, JSON.stringify({ token: "t" }));
    await expect(readOnly.write("grant_access", { account: "u1" }, "k-00000001")).rejects.toThrow(/cannot grant access/);
    await expect(c.write("create_account", { username: "dee" }, "k-00000004")).rejects.toThrow(/target.email\}" has no value/);
    await expect(c.write("revoke_access", { account: "u1" }, "k-00000002")).rejects.toThrow(/has no value/);
    await expect(c.write("disable_account", { account: "u1" }, "k-00000003")).rejects.toThrow(/HTTP 500/);
  });
});

describe("definition extensions (INTEGRATION-P0-21 slice 1)", () => {
  it("regex extracts a group, the whole match, or null; replace swaps plain text", () => {
    expect(applyTransform("CN=Ava Lee,OU=Finance,DC=acme", { regex: "OU=([^,]+)" })).toBe("Finance");
    expect(applyTransform("emp-00412", { regex: "\\d+" })).toBe("00412");
    expect(applyTransform("ava@acme.example", { regex: "^([^@]+)@(.+)$", group: 2 })).toBe("acme.example");
    expect(applyTransform("no digits", { regex: "\\d+" })).toBeNull();
    expect(applyTransform(null, { regex: "x" })).toBeNull();
    expect(applyTransform("a.b.c", { replace: ".", with: "/" })).toBe("a/b/c");
    expect(applyTransform(["x-1", "x-2"], { replace: "x-", with: "" })).toEqual(["1", "2"]);
  });

  it("an unsafe pattern never runs, even if it reached a stored definition", () => {
    expect(applyTransform("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", { regex: "(a+)+$" })).toBeNull();
  });

  it("coalesce falls back to other fields; dateAdd moves a date", () => {
    const scope = { record: { empty: "", alt: "", work: "w@acme.example", hired: "2026-01-31" } };
    expect(mapField({ path: "empty", transform: [{ coalesce: ["alt", "work"] }] }, scope)).toBe("w@acme.example");
    expect(mapField({ path: "work", transform: [{ coalesce: ["alt"] }] }, scope)).toBe("w@acme.example");
    expect(mapField({ path: "hired", transform: [{ dateAdd: 90 }] }, scope)).toBe("2026-05-01");
    expect(mapField({ path: "hired", transform: [{ dateAdd: 1, unit: "months" }] }, scope)).toBe("2026-03-03");
    expect(mapField({ path: "hired", transform: [{ dateAdd: -1, unit: "years" }] }, scope)).toBe("2025-01-31");
    expect(mapField({ path: "work", transform: [{ dateAdd: 1 }] }, scope)).toBeNull();
  });

  it("the validator checks the new transforms, and refuses unsafe patterns", () => {
    const identity = base.resources.identity as ResourceSpec;
    const withFields = (fields: Record<string, unknown>) => ({ ...base, resources: { ...base.resources, identity: { ...identity, fields: { ...identity.fields, ...fields } } } });
    expect(validateDefinition(withFields({ department: { path: "dn", transform: [{ regex: "OU=([^,]+)" }, { replace: "_", with: " " }, { coalesce: ["dept"] }] }, startDate: { path: "start", transform: [{ dateAdd: -7 }] } })).issues).toEqual([]);
    const bad = (t: unknown) => validateDefinition(withFields({ department: { path: "dn", transform: [t] } })).issues.map((i) => `${i.path}: ${i.message}`).join("\n");
    expect(bad({ regex: "(a+)+" })).toMatch(/must not repeat a group/);
    expect(bad({ regex: "(a|aa)*" })).toMatch(/must not repeat a group/);
    expect(bad({ regex: "(a)\\1" })).toMatch(/back-references/);
    expect(bad({ regex: "[" })).toMatch(/not a valid regular expression/);
    expect(bad({ regex: "x".repeat(201) })).toMatch(/1 to 200 characters/);
    expect(bad({ regex: "x", group: 12 })).toMatch(/group: must be 0 to 9/);
    expect(bad({ replace: "", with: "x" })).toMatch(/replace, with/);
    expect(bad({ coalesce: [] })).toMatch(/1 to 10 field paths/);
    expect(bad({ dateAdd: 1.5 })).toMatch(/whole number/);
    expect(bad({ dateAdd: 1, unit: "weeks" })).toMatch(/days, months or years/);
  });

  it("an API key in the body: every request must carry a body; the key joins it and never the URL", async () => {
    const bodyAuth: ConnectorDefinition = {
      ...fast,
      key: "acme-body",
      auth: { type: "body", name: "api_key", value: "{secret.key}", fields: [{ key: "key", label: "API key" }] },
      test: { request: { method: "POST", path: "/ping", body: {} } },
      resources: { identity: { request: { method: "POST", path: "/users/search", body: { status: "all" } }, records: "users", fields: { externalId: "id", displayName: "name" } } },
    };
    expect(validateDefinition(bodyAuth).issues).toEqual([]);
    const getIssues = validateDefinition({ ...bodyAuth, test: { request: { path: "/ping" } } }).issues.map((i) => `${i.path}: ${i.message}`).join("\n");
    expect(getIssues).toMatch(/test.request.method: must not be GET/);
    expect(validateDefinition({ ...bodyAuth, resources: { identity: { ...(bodyAuth.resources.identity as ResourceSpec), request: { path: "/users", body: { api_key: "{secret.key}" } } } } }).issues.map((i) => i.message).join("\n")).toMatch(/secret/);

    const { fetchImpl, calls } = fakeFetch(() => json({ users: [{ id: "u1", name: "Ava" }] }));
    const s = new HttpSession(bodyAuth, { baseUrl: "https://acme.example" }, { key: "k3y" }, fetchImpl);
    await s.fetchAll((bodyAuth.resources.identity as ResourceSpec).request!, "users", undefined, { settings: {} }, 100);
    expect(JSON.parse(calls[0].body!)).toEqual({ status: "all", api_key: "k3y" });
    expect(calls[0].url.search).toBe("");
    expect(calls[0].headers.Authorization).toBeUndefined();
    await expect(s.send({ path: "/users" }, { settings: {} })).rejects.toThrow(/cannot be a GET/);
  });
});

describe("incremental resources (INTEGRATION-P0-21 slice 2)", () => {
  const withChanges: ConnectorDefinition = {
    ...fast,
    key: "acme-changes",
    resources: {
      identity: {
        request: { path: "/users" },
        records: "users",
        changes: { request: { path: "/users", query: { updated_since: "{cursor.since}" } }, records: "changed" },
        fields: { externalId: "id", displayName: "name" },
      },
      account: { request: { path: "/accounts" }, records: "", fields: { externalId: "id" } },
    },
  };
  const config = { definition: { key: withChanges.key, version: withChanges.version, origin: "custom" }, manifest: withChanges, settings: { baseUrl: "https://acme.example" } };

  it("validates a changes request: it must use the cursor, only with http and no forEach", () => {
    expect(validateDefinition(withChanges).issues).toEqual([]);
    const bad = (changes: unknown, extra: Record<string, unknown> = {}) =>
      validateDefinition({ ...withChanges, resources: { ...withChanges.resources, identity: { ...(withChanges.resources.identity as ResourceSpec), changes, ...extra } } })
        .issues.map((i) => `${i.path}: ${i.message}`)
        .join("\n");
    expect(bad({ request: { path: "/users" } })).toMatch(/must use \{cursor.since\}/);
    expect(bad({ request: { path: "/users", query: { since: "{cursor.until}" } } })).toMatch(/must be one of \{cursor.since\}/);
    expect(bad({ request: { path: "/users", query: { since: "{secret.token}" } } })).toMatch(/not allowed here|secret/);
    expect(bad({ request: { path: "/u/{cursor.sinceEpoch}" }, extra: 1 })).toMatch(/takes only request, records and pagination/);
    expect(bad({ request: { path: "/u/{cursor.since}" } }, { forEach: "account" })).toMatch(/only for a resource without forEach or unwind/);
    expect(validateDefinition({ ...withChanges, resources: { ...withChanges.resources, account: { request: { path: "/accounts", query: { s: "{cursor.since}" } }, fields: { externalId: "id" } } } }).issues.map((i) => i.message).join()).toMatch(/not allowed here/);
  });

  it("a full run reads the whole list; an incremental run asks for changes since the cursor and reads other kinds in full", async () => {
    const { fetchImpl, calls } = fakeFetch((u) => (u.pathname === "/accounts" ? json([{ id: "a1" }]) : u.searchParams.has("updated_since") ? json({ changed: [{ id: "u2", name: "Bo" }] }) : json({ users: [{ id: "u1", name: "Ava" }, { id: "u2", name: "Bo" }] })));
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await c.authenticate(config, JSON.stringify({ token: "t" }));
    expect(c.supportsIncremental()).toBe(true);
    expect((await c.importKind("identity")).map((r) => r.externalId)).toEqual(["u1", "u2"]);

    await c.authenticate(config, JSON.stringify({ token: "t" }));
    c.readChangesSince(new Date("2026-10-12T10:55:00Z"));
    expect((await c.importKind("identity")).map((r) => r.externalId)).toEqual(["u2"]);
    expect((await c.importKind("account")).map((r) => r.externalId)).toEqual(["a1"]);
    expect(calls.at(-2)!.url.searchParams.get("updated_since")).toBe("2026-10-12T10:55:00.000Z");

    // A new authentication (the next run) starts full again.
    await c.authenticate(config, JSON.stringify({ token: "t" }));
    expect((await c.importKind("identity")).length).toBe(2);
    const plain = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await plain.authenticate({ ...config, manifest: base }, JSON.stringify({ token: "t" }));
    expect(plain.supportsIncremental()).toBe(false);
  });
});

describe("signing in with a private key or a client certificate (INTEGRATION-P0-21 part 3)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const oauth = (extra: Record<string, unknown>): ConnectorDefinition =>
    ({
      ...fast,
      key: "acme-jwt",
      auth: { type: "oauth2_client_credentials", tokenUrl: "/oauth/token", clientId: "{secret.clientId}", fields: [{ key: "clientId", label: "Client ID" }, { key: "privateKey", label: "Private key" }], ...extra },
    }) as unknown as ConnectorDefinition;

  it("validates the private-key modes and client certificates", () => {
    const msgs = (d: unknown) => validateDefinition(d).issues.map((i) => `${i.path}: ${i.message}`).join("\n");
    expect(msgs(oauth({ clientAuth: "private_key_jwt", privateKey: "{secret.privateKey}", keyId: "k1" }))).toBe("");
    expect(msgs(oauth({ grant: "jwt_bearer", privateKey: "{secret.privateKey}", algorithm: "ES256", subject: "{settings.baseUrl}" }))).toBe("");
    expect(msgs(oauth({ clientAuth: "private_key_jwt" }))).toMatch(/auth.privateKey: is required: the private key/);
    expect(msgs(oauth({ clientAuth: "private_key_jwt", privateKey: "{settings.baseUrl}" }))).toMatch(/must come from a secret field/);
    expect(msgs(oauth({ grant: "jwt_bearer", privateKey: "{secret.privateKey}", algorithm: "HS256" }))).toMatch(/algorithm: must be RS256 or ES256/);
    expect(msgs(oauth({ grant: "password", privateKey: "{secret.privateKey}" }))).toMatch(/grant: must be client_credentials or jwt_bearer/);
    expect(msgs(oauth({ privateKey: "{secret.privateKey}" }))).toMatch(/auth.clientSecret: is required/);
    expect(msgs(oauth({ clientSecret: "{secret.privateKey}", keyId: "k1" }))).toMatch(/need clientAuth private_key_jwt or the jwt_bearer grant/);
    const cert = { ...fast, key: "acme-mtls", auth: { type: "client_certificate", certificate: "{secret.cert}", privateKey: "{secret.key}", fields: [{ key: "cert", label: "Certificate" }, { key: "key", label: "Key" }] } };
    expect(msgs(cert)).toBe("");
    expect(msgs({ ...cert, auth: { ...cert.auth, certificate: "-----BEGIN CERTIFICATE-----" } })).toMatch(/certificate: must come from a secret field/);
    expect(msgs({ ...cert, driver: "ldap", resources: {} })).toMatch(/auth.type: must be one of/);
  });

  it("private_key_jwt: the token request carries a signed client assertion and no secret", async () => {
    let form = new URLSearchParams();
    const { fetchImpl, calls } = fakeFetch(async (u, init) => {
      if (u.pathname === "/oauth/token") {
        form = new URLSearchParams(init.body);
        return json({ access_token: "tok", expires_in: 300 });
      }
      return json({ data: [] });
    });
    const s = new HttpSession(oauth({ clientAuth: "private_key_jwt", privateKey: "{secret.privateKey}", keyId: "k1" }), { baseUrl: "https://idp.example" }, { clientId: "client-1", privateKey: keyPem }, fetchImpl);
    await s.send({ path: "/users" }, { settings: {} });
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("client-1");
    expect(form.get("client_secret")).toBeNull();
    expect(form.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    const [h, c, sig] = form.get("client_assertion")!.split(".");
    expect(verify("sha256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({ iss: "client-1", sub: "client-1", aud: "https://idp.example/oauth/token" });
    expect(calls[1].headers.Authorization).toBe("Bearer tok");
  });

  it("jwt_bearer: the assertion is the grant, for the subject given", async () => {
    let form = new URLSearchParams();
    const { fetchImpl } = fakeFetch(async (u, init) => {
      if (u.pathname === "/oauth/token") {
        form = new URLSearchParams(init.body);
        return json({ access_token: "tok" });
      }
      return json({});
    });
    const s = new HttpSession(oauth({ grant: "jwt_bearer", privateKey: "{secret.privateKey}", subject: "admin@acme.example", scope: "directory.read" }), { baseUrl: "https://idp.example" }, { clientId: "svc@acme.example", privateKey: keyPem }, fetchImpl);
    await s.send({ path: "/users" }, { settings: {} });
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("client_assertion")).toBeNull();
    const claims = JSON.parse(Buffer.from(form.get("assertion")!.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({ iss: "svc@acme.example", sub: "admin@acme.example", scope: "directory.read" });
  });

  it("a broken key fails the sign-in with a reason that does not contain the key", async () => {
    const { fetchImpl } = fakeFetch(() => json({}));
    const s = new HttpSession(oauth({ clientAuth: "private_key_jwt", privateKey: "{secret.privateKey}" }), { baseUrl: "https://idp.example" }, { clientId: "c", privateKey: "-----BEGIN PRIVATE KEY-----\nnot-really\n-----END PRIVATE KEY-----" }, fetchImpl);
    const err = await s.send({ path: "/users" }, { settings: {} }).catch((e: Error) => e);
    expect(String(err)).toMatch(/not a PEM private key/);
    expect(String(err)).not.toMatch(/not-really/);
  });

  it("client_certificate: the request carries the certificate to the connection's own https address, and nothing in its headers", async () => {
    const def = { ...fast, key: "acme-mtls", auth: { type: "client_certificate", certificate: "{secret.cert}", privateKey: "{secret.key}", fields: [{ key: "cert", label: "Certificate" }, { key: "key", label: "Key" }] } } as unknown as ConnectorDefinition;
    const seen: { clientCert?: unknown; headers?: Record<string, string> }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(init);
      return json({});
    };
    await new HttpSession(def, { baseUrl: "https://acme.example" }, { cert: "CERT", key: "KEY" }, fetchImpl).send({ path: "/users" }, { settings: {} });
    expect(seen[0].clientCert).toEqual({ cert: "CERT", key: "KEY" });
    expect(seen[0].headers?.Authorization).toBeUndefined();
    await expect(new HttpSession(def, { baseUrl: "http://acme.example" }, { cert: "CERT", key: "KEY" }, fetchImpl).send({ path: "/users" }, { settings: {} })).rejects.toThrow(/only sent over https/);
  });
});

describe("signing in with the provider (INTEGRATION-P0-21 part 3b)", () => {
  const code = (extra: Record<string, unknown> = {}): ConnectorDefinition =>
    ({
      ...fast,
      key: "acme-code",
      settings: [...fast.settings, { key: "loginUrl", label: "Sign-in address", type: "url", required: true }],
      auth: {
        type: "oauth2_authorization_code",
        authorizeUrl: "{settings.loginUrl}/authorize",
        tokenUrl: "{settings.loginUrl}/token",
        clientId: "{secret.clientId}",
        clientSecret: "{secret.clientSecret}",
        scope: "directory.read offline_access",
        fields: [{ key: "clientId", label: "Client ID" }, { key: "clientSecret", label: "Client secret" }],
        ...extra,
      },
    }) as unknown as ConnectorDefinition;
  const settings = { baseUrl: "https://api.acme.example", loginUrl: "https://login.acme.example" };
  const secrets = { clientId: "client-1", clientSecret: "s3cret" };

  it("validates the sign-in and token addresses, the client secret and the extra sign-in parameters", () => {
    const msgs = (d: unknown) => validateDefinition(d).issues.map((i) => `${i.path}: ${i.message}`).join("\n");
    expect(msgs(code({ authorizeParams: { prompt: "consent", access_type: "offline" } }))).toBe("");
    expect(msgs(code({ authorizeUrl: "https://evil.example/authorize" }))).toMatch(/auth.authorizeUrl: must be a path/);
    expect(msgs(code({ tokenUrl: undefined }))).toMatch(/auth.tokenUrl: is required/);
    expect(msgs(code({ clientSecret: "{settings.baseUrl}" }))).toMatch(/clientSecret: must come from a secret field/);
    expect(msgs(code({ authorizeParams: { redirect_uri: "https://evil.example" } }))).toMatch(/redirect_uri: is set by WonderID/);
    expect(msgs(code({ authorizeParams: { hint: "{secret.clientSecret}" } }))).toMatch(/cannot hold a secret/);
    expect(msgs(code({ fields: [{ key: "_oauth_refresh_token", label: "Sneaky" }, { key: "clientId", label: "Id" }, { key: "clientSecret", label: "S" }] }))).toMatch(/fields\[0\]\.key: must be letters/);
    expect(msgs({ ...code(), driver: "ldap", resources: {} })).toMatch(/auth.type: must be one of/);
  });

  it("builds the provider's sign-in address with PKCE, on the connection's own address only", () => {
    const { fetchImpl, calls } = fakeFetch(() => json({}));
    const s = new HttpSession(code({ authorizeParams: { prompt: "consent" } }), settings, secrets, fetchImpl);
    const url = new URL(s.authorizationUrl({ state: "st", codeChallenge: "ch", redirectUri: "https://id.example/api/connect/v1/c/oauth/callback" }));
    expect(url.origin + url.pathname).toBe("https://login.acme.example/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      prompt: "consent",
      response_type: "code",
      client_id: "client-1",
      redirect_uri: "https://id.example/api/connect/v1/c/oauth/callback",
      scope: "directory.read offline_access",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
    expect(url.toString()).not.toMatch(/s3cret/);
    expect(calls).toHaveLength(0);
  });

  it("trades the code for tokens and refuses a provider that gives no refresh token", async () => {
    let form = new URLSearchParams();
    const { fetchImpl } = fakeFetch(async (u, init) => {
      form = new URLSearchParams(init.body);
      return json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 });
    });
    const s = new HttpSession(code(), settings, secrets, fetchImpl);
    await s.exchangeCode("the-code", "the-verifier", "https://id.example/cb");
    expect(Object.fromEntries(form)).toEqual({ grant_type: "authorization_code", code: "the-code", redirect_uri: "https://id.example/cb", code_verifier: "the-verifier", client_id: "client-1", client_secret: "s3cret" });
    expect(s.rotatedSecrets()).toMatchObject({ _oauth_refresh_token: "rt-1", _oauth_access_token: "at-1" });
    const noRefresh = new HttpSession(code(), settings, secrets, fakeFetch(() => json({ access_token: "at" })).fetchImpl);
    await expect(noRefresh.exchangeCode("c", "v", "https://id.example/cb")).rejects.toThrow(/no refresh token/);
  });

  it("refreshes with the stored refresh token, keeps a rotated one, and uses the stored access token while it is valid", async () => {
    const forms: URLSearchParams[] = [];
    const { fetchImpl, calls } = fakeFetch(async (u, init) => {
      if (u.pathname === "/token") {
        forms.push(new URLSearchParams(init.body));
        return json({ access_token: "at-new", refresh_token: "rt-2", expires_in: 3600 });
      }
      return json({ ok: true });
    });
    const s = new HttpSession(code(), settings, { ...secrets, _oauth_refresh_token: "rt-1" }, fetchImpl);
    await s.send({ path: "/users" }, { settings: {} });
    expect(forms[0].get("grant_type")).toBe("refresh_token");
    expect(forms[0].get("refresh_token")).toBe("rt-1");
    expect(calls.at(-1)!.headers.Authorization).toBe("Bearer at-new");
    expect(s.rotatedSecrets()).toMatchObject({ _oauth_refresh_token: "rt-2", _oauth_access_token: "at-new" });

    const cached = fakeFetch(() => json({ ok: true }));
    const later = new HttpSession(code(), settings, { ...secrets, _oauth_refresh_token: "rt-2", _oauth_access_token: "at-kept", _oauth_expires_at: String(Date.now() + 600_000) }, cached.fetchImpl);
    await later.send({ path: "/users" }, { settings: {} });
    expect(cached.calls).toHaveLength(1);
    expect(cached.calls[0].headers.Authorization).toBe("Bearer at-kept");
    expect(later.rotatedSecrets()).toBeNull();
  });

  it("not connected yet, or a revoked sign-in, fails with what to do and no token in the message", async () => {
    const s = new HttpSession(code(), settings, secrets, fakeFetch(() => json({})).fetchImpl);
    await expect(s.send({ path: "/users" }, { settings: {} })).rejects.toThrow(/Not connected yet/);
    const revoked = new HttpSession(code(), settings, { ...secrets, _oauth_refresh_token: "rt-old" }, fakeFetch(() => json({ error: "invalid_grant", refresh_token: "rt-old" }, { status: 400 })).fetchImpl);
    const err = await revoked.send({ path: "/users" }, { settings: {} }).catch((e: Error) => e);
    expect(String(err)).toMatch(/expired or was revoked: connect the connection again/);
    expect(String(err)).not.toMatch(/rt-old/);
  });

  it("the connector reports a connection that awaits sign-in, and the tokens a run obtained", async () => {
    const { fetchImpl } = fakeFetch(async (u) => (u.pathname === "/token" ? json({ access_token: "at", refresh_token: "rt-9", expires_in: 60 }) : json({})));
    const c = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    const config = { definition: { key: "acme-code", version: "1.0.0", origin: "custom" }, manifest: code(), settings };
    await c.authenticate(config, JSON.stringify(secrets));
    expect(c.awaitsAuthorization()).toBe(true);
    expect((await c.testConnection()).message).toMatch(/Not connected yet/);
    await c.authenticate(config, JSON.stringify({ ...secrets, _oauth_refresh_token: "rt-1" }));
    expect(c.awaitsAuthorization()).toBe(false);
    expect((await c.testConnection()).ok).toBe(true);
    await c.close();
    expect(c.obtainedTokens()).toMatchObject({ _oauth_refresh_token: "rt-9" });
  });
});

describe("WID-H05: a custom API-key header is named to the guard", () => {
  it("passes the header's name as a credential header, so a redirect to another origin drops it", async () => {
    const seen: { credentialHeaders?: string[]; headers?: Record<string, string> }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(init);
      return json({});
    };
    const def = { ...fast, auth: { type: "header", name: "X-Acme-Key", value: "{secret.key}", fields: [{ key: "key", label: "Key" }] } } as unknown as ConnectorDefinition;
    await new HttpSession(def, { baseUrl: "https://acme.example" }, { key: "k" }, fetchImpl).send({ path: "/users" }, { settings: {} });
    expect(seen[0].credentialHeaders).toEqual(["X-Acme-Key"]);
    expect(seen[0].headers?.["X-Acme-Key"]).toBe("k");
  });
});
