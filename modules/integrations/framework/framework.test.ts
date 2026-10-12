import { describe, expect, it } from "vitest";
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
